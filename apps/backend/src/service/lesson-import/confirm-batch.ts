import { beginTx } from '../../transport/database/postgres-client'
import type { StudyIntent } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { ImportBatchesRepositoryInterface } from '../../transport/database/import-batches/import-batches-repository'
import type { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import {
  mergeFacet,
  type UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import type {
  FacetSkill,
  StudyFacetsRepositoryInterface,
} from '../../transport/database/study-facets/study-facets-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import {
  HARD_MAX_PRACTICE_NEW_TERMS,
  type UserTargetLanguagePrefsRepositoryInterface,
} from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { TeacherProfilesRepositoryInterface } from '../../transport/database/teacher-profiles/teacher-profiles-repository'
import type { ExtractedLessonRow } from '../../transport/third-party/anthropic/passes/extract-lesson-pass'
import { applyStudyIntent } from '../study-facets/apply-study-intent'
import { applyTermRating } from '../practice/rate-term'
import { getOrCreateLessonSession } from './get-or-create-lesson-session'

// The batch was not in 'ready' state — a double-submit (already confirmed),
// a still-running extraction, or a failed batch. The router maps this to 409.
export class ConfirmBatchConflictError extends Error {
  constructor() {
    super('Import batch is not ready to confirm')
    this.name = 'ConfirmBatchConflictError'
  }
}

// The user never completed onboarding (no native language) — same recovery as
// the other ingestion flows: finish onboarding on the web.
export class ConfirmBatchNeedsOnboardingError extends Error {
  constructor() {
    super('Native language is not set')
    this.name = 'ConfirmBatchNeedsOnboardingError'
  }
}

// No CEFR level stored for the batch's target language — the session's
// cefr_level calibrates card explanations, so we refuse to guess. The client
// recovers by asking for the level (CefrStep) and retrying the confirm.
export class ConfirmBatchCefrNotSetError extends Error {
  constructor() {
    super('CEFR level is not set for the target language')
    this.name = 'ConfirmBatchCefrNotSetError'
  }
}

export type ConfirmBatchDeps = {
  importBatchesRepository: ImportBatchesRepositoryInterface
  teacherProfilesRepository: TeacherProfilesRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  studyFacetsRepository: StudyFacetsRepositoryInterface
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  usersRepository: UsersRepositoryInterface
}

export type ConfirmRowDecision = {
  rowId: string
  accepted: boolean
  // Overrides the row's proposed facets when the user edited the chips.
  skills?: FacetSkill[]
}

const FACET_TO_SKILL: Record<string, FacetSkill> = {
  production: 'meaning_production',
  recognition: 'meaning_recognition',
  pronunciation: 'pronunciation',
}

// Extractor facet names -> app facet skills. Shared with the router's row DTO
// mapper so the confirm screen and the confirm apply read the same proposal.
export const mapProposedFacetsToSkills = (proposedFacets: ExtractedLessonRow['proposedFacets']): FacetSkill[] => [
  ...new Set(proposedFacets.map((f) => FACET_TO_SKILL[f]).filter(Boolean)),
]

const skillsForRow = (payload: ExtractedLessonRow, decision: ConfirmRowDecision): FacetSkill[] => {
  if (decision.skills && decision.skills.length > 0) return [...new Set(decision.skills)]
  return mapProposedFacetsToSkills(payload.proposedFacets)
}

// Confirm a ready batch: entirely LLM-free. One transaction, opened by the
// guarded status claim (ready -> confirmed), makes the whole confirm
// idempotent and all-or-nothing: session chain, segments, highlights,
// enrich_highlight jobs (a DB insert, so it participates), facet adds, lapse
// events, and row updates commit together or not at all. Card creation and all
// LLM work happen afterwards in the standard background enrichment pipeline —
// the session-vocabulary view's EnrichingRow polling UX works unchanged.
export const confirmBatch = async (
  params: { userId: string; batchId: string; decisions: ConfirmRowDecision[]; saveProfileName?: string },
  deps: ConfirmBatchDeps
): Promise<{ sessionId: string }> => {
  const { userId, batchId } = params

  // Resolve session prefs before opening the transaction (reads only).
  const nativeLanguage = await deps.usersRepository.getNativeLanguage(userId)
  if (!nativeLanguage) throw new ConfirmBatchNeedsOnboardingError()

  const result = await beginTx(async (tx) => {
    const batch = await deps.importBatchesRepository.claimForConfirm({ batchId, userId }, tx)
    if (!batch) throw new ConfirmBatchConflictError()

    // Throwing here rolls back the status claim, so the batch stays 'ready'
    // and the confirm can be retried once the level is set.
    const prefs = await deps.userTargetLanguagePrefsRepository.findForLanguage(userId, batch.target_language)
    const cefrLevel = prefs?.cefr_level
    if (!cefrLevel) throw new ConfirmBatchCefrNotSetError()

    const { session, track } = await getOrCreateLessonSession({ batch, userId, nativeLanguage, cefrLevel }, tx)
    await deps.importBatchesRepository.setStudySessionId({ batchId: batch.id, studySessionId: session.id }, tx)

    const rows = await deps.importBatchesRepository.listRows(batch.id, tx)
    const decisionByRowId = new Map(params.decisions.map((d) => [d.rowId, d]))
    const encounteredLookupIds: string[] = []

    for (const row of rows) {
      const decision = decisionByRowId.get(row.id)
      const payload = row.payload as unknown as ExtractedLessonRow
      const skills = decision ? skillsForRow(payload, decision) : []
      const accepted = Boolean(decision?.accepted) && row.planned_action !== 'skip' && skills.length > 0
      await deps.importBatchesRepository.setRowConfirmed({ rowId: row.id, confirmed: accepted }, tx)
      if (!accepted) continue

      const targetForm = payload.targetForm
      const surface = (targetForm || payload.headword).trim()
      const intent: StudyIntent = { skills, formScope: targetForm ? 'form' : 'lemma' }

      if (row.planned_action === 'create') {
        // Segment text: the studied form, then the corrected context when it
        // adds anything. The highlight covers the leading form exactly, so the
        // enrich job sees the same selection shape a reader gloss-save produces.
        const context = payload.context.trim()
        const segmentText = context && context !== surface ? `${surface} — ${context}` : surface
        const segment = await deps.textSegmentsRepository.appendSegmentAtomic(
          { textTrackId: track.id, text: segmentText, startMs: null, endMs: null },
          tx
        )
        const highlight = await deps.highlightsRepository.insertHighlight(
          {
            studySessionId: session.id,
            startSegmentId: segment.id,
            endSegmentId: segment.id,
            startOffset: 0,
            endOffset: surface.length,
            selectionText: surface,
            note: null,
            presetTags: [],
            studyIntent: intent as unknown as Record<string, unknown>,
            fastGloss: null,
          },
          tx
        )
        await deps.processingJobsRepository.enqueue(
          { kind: 'enrich_highlight', sessionId: session.id, userId, highlightId: highlight.id },
          tx
        )
        continue
      }

      // add_facet / lapse_and_add_facet — the term already exists.
      const duplicateId = row.duplicate_user_lookup_id
      if (!duplicateId) continue
      await applyStudyIntent(
        { userLookupId: duplicateId, userId, surfaceForm: surface, intent },
        { userLookupsRepository: deps.userLookupsRepository, studyFacetsRepository: deps.studyFacetsRepository },
        tx
      )
      // A lesson error on a known term IS revealed demand — bump the priority
      // signals (collapse window makes double-confirm attempts harmless).
      encounteredLookupIds.push(duplicateId)

      if (row.planned_action === 'lapse_and_add_facet') {
        // Implicit 'again' on the production citation facet, applied directly
        // via applyTermRating (never the rateTerm wrapper): the facet exists,
        // so the introduction guard is skipped; a parked leech is a safe
        // no-op; shouldParkLeech may park — desired. Re-check the live state
        // inside the transaction — the resolution snapshot may be stale.
        const lookup = await deps.userLookupsRepository.findByIdForUser(duplicateId, userId)
        const facet = await deps.studyFacetsRepository.getFacet(
          { userLookupId: duplicateId, skill: 'meaning_production', targetForm: '' },
          tx
        )
        if (lookup && facet && facet.disabled_at === null && facet.srs_state === 'review') {
          await applyTermRating({
            lookup: mergeFacet(lookup, facet),
            userId,
            rating: 'again',
            pool: 'production',
            maxNewTerms: HARD_MAX_PRACTICE_NEW_TERMS,
            wasExplicit: false,
            importBatchId: batch.id,
            deps: {
              userLookupsRepository: deps.userLookupsRepository,
              studyFacetsRepository: deps.studyFacetsRepository,
              practiceRatingEventsRepository: deps.practiceRatingEventsRepository,
              userTargetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
              withTransaction: (fn) => fn(tx),
            },
          })
        }
      }
    }

    await deps.userLookupsRepository.recordEncounter(encounteredLookupIds, tx)
    return { sessionId: session.id, formatProfile: batch.format_profile, targetLanguage: batch.target_language }
  })

  // Optional profile save — outside the transaction (a failure here must not
  // roll back a completed confirm; the user can re-save from the next upload).
  if (params.saveProfileName && result.formatProfile) {
    await deps.teacherProfilesRepository.upsert({
      userId,
      name: params.saveProfileName,
      language: result.targetLanguage,
      profileText: result.formatProfile,
    })
  }

  return { sessionId: result.sessionId }
}
