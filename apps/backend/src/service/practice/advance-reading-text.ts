import type { DbPracticeText, ReadingGroup } from '../../transport/database/practice-texts/practice-texts-repository'
import {
  mergeFacet,
  type DbUserLookupWithFacet,
  type PracticePool,
} from '../../transport/database/user-lookups/user-lookups-repository'
import {
  CITATION_FORM,
  skillForPool,
  type StudyFacetsRepositoryInterface,
} from '../../transport/database/study-facets/study-facets-repository'
import type { ReadingRating, ReviewScope } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  produceNextReadable,
  resolveLanguagePrefs,
  type GenerateReadingTextDependencies,
} from './generate-reading-text'
import { applyTermRating, type WithTransaction } from './rate-term'
import { clampPracticeSessionLimits } from './review-caps'

// The finalizer additionally needs the transaction runner so each applied
// rating's FSRS write + event-log row commit atomically (see applyTermRating),
// and the facet repository to load the citation facet being rated.
export type AdvanceReadingTextDependencies = GenerateReadingTextDependencies & {
  withTransaction: WithTransaction
  studyFacetsRepository: StudyFacetsRepositoryInterface
}

export type AdvanceReadingTextResult =
  | { ok: true; done: false; practiceText: DbPracticeText; introduced: number }
  | { ok: true; done: true; introduced: number }
  | { ok: false; reason: 'text_not_found' | 'no_native_language' | 'generation_failed'; warning?: string }

type RawAnnotation = { headword?: unknown; sense?: unknown }

const readAnnotations = (text: DbPracticeText): Array<{ headword: string; sense: string }> => {
  const raw = Array.isArray(text.annotations) ? (text.annotations as RawAnnotation[]) : []
  return raw
    .map((a) => ({
      headword: typeof a.headword === 'string' ? a.headword : '',
      sense: typeof a.sense === 'string' ? a.sense : '',
    }))
    .filter((a) => a.headword.length > 0)
}

const dateValue = (value: string | Date | null | undefined): number | null => {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

const wasReviewedAfterTextWasPrepared = (lookup: DbUserLookupWithFacet, text: DbPracticeText): boolean => {
  const preparedAt = dateValue(text.ready_at) ?? dateValue(text.created_at)
  if (preparedAt == null) return false
  const lastReview = dateValue(lookup.srs_last_review)
  return lastReview != null && lastReview > preparedAt
}

const isEligibleForScope = (
  lookup: DbUserLookupWithFacet,
  pool: PracticePool,
  scope: ReviewScope,
  now: Date
): boolean => {
  if (pool === 'active' && lookup.learning_mode !== 'active') return false
  const state = lookup.srs_state
  const due = lookup.srs_due
  const wantsNew = scope === 'learn_new' || scope === 'mixed'
  const wantsDue = scope === 'review_due' || scope === 'mixed'
  if (state == null) return wantsNew
  if (!wantsDue || !due) return false
  const dueAt = dateValue(due)
  return dueAt != null && dueAt <= now.getTime()
}

// The single reading-mode mutation. Idempotent via the one-shot reading->done
// claim: the winner applies FSRS for every annotation (explicit from `ratings`,
// implicit 'good' for the rest); a loser (double-click / retry) applies nothing.
// Both then surface the next readable text (or done).
export const advanceReadingText = async (
  userId: string,
  textId: string,
  pool: PracticePool,
  scope: ReviewScope,
  ratings: ReadingRating[],
  deps: AdvanceReadingTextDependencies
): Promise<AdvanceReadingTextResult> => {
  const found = await deps.practiceTextsRepository.findByIdForUser(textId, userId)
  if (!found) return { ok: false, reason: 'text_not_found' }

  const targetLanguage = found.targetLanguage
  // Trust the stored pool over the client-supplied one for the rating routing.
  const effectivePool = found.pool
  const group: ReadingGroup = { userId, targetLanguage, pool: effectivePool }

  const langPrefs = await resolveLanguagePrefs(userId, targetLanguage, deps)
  if (!langPrefs) return { ok: false, reason: 'no_native_language' }

  // Atomic finalize gate. Only the winner applies FSRS.
  const claimed = await deps.practiceTextsRepository.claimFinalize(textId)

  let introduced = 0
  const ratedLookupIds: string[] = []

  if (claimed) {
    const ratingByLookupId = new Map(ratings.map((r) => [r.userLookupId, r.rating]))
    // Pass the FULL clamped per-language daily cap: the atomic guard does its
    // own today-count comparison against it (passing the remaining-new would
    // double-count).
    const { maxNewTerms } = clampPracticeSessionLimits(
      await deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(userId, targetLanguage)
    )
    const seen = new Set<string>()
    const now = new Date()
    for (const ann of readAnnotations(claimed)) {
      const lookup = await deps.userLookupsRepository.findByKey({
        userId,
        targetLanguage,
        headword: ann.headword,
        sense: ann.sense,
      })
      if (!lookup || seen.has(lookup.id)) continue
      seen.add(lookup.id)
      ratedLookupIds.push(lookup.id)
      // Reading stays citation-meaning-only; load the facet for the pool's
      // citation skill and merge it. A non-active term has no production facet —
      // getFacet returns null and the term is simply skipped (not eligible).
      const skill = skillForPool(effectivePool)
      if (skill === 'meaning_recognition') {
        await deps.studyFacetsRepository.ensureCitationFacet(lookup.id)
      }
      const facet = await deps.studyFacetsRepository.getFacet({
        userLookupId: lookup.id,
        skill,
        targetForm: CITATION_FORM,
      })
      if (!facet) continue
      const facetRow = mergeFacet(lookup, facet)
      if (wasReviewedAfterTextWasPrepared(facetRow, claimed)) continue
      if (!isEligibleForScope(facetRow, effectivePool, scope, now)) continue
      const rating = ratingByLookupId.get(lookup.id) ?? 'good'
      // Reading mode NEVER bypasses the daily-new cap — the learn-new bypass is
      // a flashcards-only affordance (driven by rateTerm's learnNewSession).
      const result = await applyTermRating({
        lookup: facetRow,
        userId,
        rating,
        pool: effectivePool,
        maxNewTerms,
        wasExplicit: ratingByLookupId.has(lookup.id),
        practiceTextId: claimed.id,
        deps,
      })
      if (result.ok && result.introducedNew) introduced += 1
    }
  }

  // Surface the next readable text. Exclude the just-rated terms so a term rated
  // 'again' (still due soon) isn't immediately re-embedded in the successor.
  const next = await produceNextReadable({
    group,
    scope,
    langPrefs,
    excludeUserLookupIds: ratedLookupIds,
    deps,
  })
  if (!next.ok) return next
  if (next.done) return { ok: true, done: true, introduced }
  return { ok: true, done: false, practiceText: next.practiceText, introduced }
}
