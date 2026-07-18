import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { highlightsContract } from '@flicktionary/api-client/orpc-contracts/highlights-contract'
import { StudyIntentSchema } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  DbHighlight,
  DbHighlightWithChunk,
  HighlightsRepositoryInterface,
} from '../../transport/database/highlights/highlights-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import { GhostCandidatesRepositoryInterface } from '../../transport/database/ghost-candidates/ghost-candidates-repository'
import {
  createNoteOnlyHighlight,
  CreateNoteOnlyHighlightDependencies,
} from '../../service/highlights/create-note-only-highlight'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { FastGloss, parseFastGlossText } from '../../transport/third-party/anthropic/passes/fast-gloss-pass'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import { getLanguageMode } from '../../service/user-prefs/language-mode'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import type { WiktionaryMatchRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import type { KnownLemmasRepositoryInterface } from '../../transport/database/known-lemmas/known-lemmas-repository'
import { getKnownLemmaCandidates } from '../../service/known-lemmas/known-lemma-candidates'
import { lookupFastGlossIpa } from '../../service/wiktionary-grounding/fast-gloss-ipa'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'

// fast_gloss is a single text column; we round-trip the {gloss, pos, register}
// triple as the same `<gloss>\n[POS]\n[register]` shape Haiku emits.
const serializeFastGloss = (g: FastGloss): string => `${g.gloss}\n${g.pos ?? ''}\n${g.register ?? ''}`

const parseFastGloss = (s: string): FastGloss => {
  return parseFastGlossText(s)
}

const toHighlightDto = (row: DbHighlight | DbHighlightWithChunk, opts?: { noteOnly?: boolean }) => {
  // study_intent is stored as loose JSONB; validate it back to the contract shape
  // (or null) so a legacy/garbled value never breaks output validation.
  const parsedIntent = StudyIntentSchema.safeParse(row.study_intent)
  return {
    id: row.id,
    studySessionId: row.study_session_id,
    startSegmentId: row.start_segment_id,
    endSegmentId: row.end_segment_id,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    selectionText: row.selection_text,
    note: row.note,
    presetTags: row.preset_tags,
    fastGloss: row.fast_gloss,
    studyIntent: parsedIntent.success ? parsedIntent.data : null,
    chunkId: 'chunk_id' in row ? row.chunk_id : null,
    // "The word is not saved as a study card": the highlight HAS a card, but
    // it is parked in needs_data — the note-only lane creates exactly that stub,
    // while a full-lane card auto-keeps within its enrich run (a failed
    // enrichment can also strand needs_data, where offering the saveWord
    // upgrade is equally right). Chunk-less rows (create/update responses)
    // can't derive this, so the note-only create and saveWord handlers pass
    // the answer explicitly; the remaining chunk-less paths only ever touch
    // non-stub highlights and default to false.
    noteOnly: opts?.noteOnly ?? ('card_status' in row && row.card_status === 'needs_data'),
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export const HighlightsRouter = (
  highlightsRepository: HighlightsRepositoryInterface,
  studySessionsRepository: StudySessionsRepositoryInterface,
  textSegmentsRepository: TextSegmentsRepositoryInterface,
  usersRepository: UsersRepositoryInterface,
  targetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface,
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface,
  processingJobsRepository: ProcessingJobsRepositoryInterface,
  ghostCandidatesRepository: GhostCandidatesRepositoryInterface,
  noteOnlyDependencies: CreateNoteOnlyHighlightDependencies,
  anthropicPasses: AnthropicPassesInterface,
  wiktionaryMatchRepository: WiktionaryMatchRepositoryInterface,
  knownLemmasRepository: KnownLemmasRepositoryInterface
): Router => {
  const implementer = implement(highlightsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  // Debounce before enriching a freshly-committed highlight, so a mis-selection
  // the user corrects (delete within the window) never reaches the LLM.
  const ENRICH_DEBOUNCE_MS = 5000

  const router = implementer.router({
    listBySession: implementer.listBySession.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      const highlights = await highlightsRepository.listBySessionId(input.sessionId)
      return { data: highlights.map((h) => toHighlightDto(h)) }
    }),

    create: implementer.create.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      // The localized chat-seed question composed on the frontend (presets + the
      // verbatim note). Shared by both lanes.
      const chatSeedPrompt = (input.chatSeedPrompt ?? '').trim() || null

      // Enqueue a seed_card_chat job — best-effort, debounced behind enrich so
      // the card is likely materialized first; the worker retries if not.
      const enqueueSeedBestEffort = async (highlightId: string): Promise<void> => {
        try {
          await processingJobsRepository.enqueueSeedCardChat({
            sessionId: input.sessionId,
            highlightId,
            userId,
            runAfter: new Date(Date.now() + ENRICH_DEBOUNCE_MS),
          })
        } catch (error) {
          logWithSentry({
            message: 'enqueue seed_card_chat failed',
            params: { sessionId: input.sessionId, highlightId },
            error,
          })
        }
      }

      const insertParams = {
        studySessionId: input.sessionId,
        startSegmentId: input.startSegmentId,
        endSegmentId: input.endSegmentId,
        startOffset: input.startOffset,
        endOffset: input.endOffset,
        selectionText: input.selectionText,
        note: input.note ?? null,
        presetTags: input.presetTags ?? [],
        studyIntent: input.studyIntent ?? null,
        fastGloss: input.fastGloss ? serializeFastGloss(input.fastGloss) : null,
        chatSeedPrompt,
      }

      // Note-only lane ("ask a question, don't make a card"): highlight + empty
      // stub card in one transaction, then seed the chat. NO basic-data pass /
      // grounding / study facets — the card stays data-less until the user
      // generates it. Skill selection (studyIntent) is ignored here.
      if (input.noteOnly) {
        const inserted = await createNoteOnlyHighlight(
          { ...insertParams, userId, targetLanguage: session.target_language, adoptedGhostId: input.adoptedGhostId },
          noteOnlyDependencies
        )
        if (chatSeedPrompt) await enqueueSeedBestEffort(inserted.id)
        // The bare insert row carries no chunk join, so state the stub-ness the
        // transaction just created.
        return { data: toHighlightDto(inserted, { noteOnly: true }) }
      }

      // Pre-save ghost adoption: the client swapped its local selection to the
      // ghost's span, so the insert + ghost dismissal + enrich enqueue happen in
      // one transaction (see insertHighlightAdoptingGhost — an already-dismissed
      // ghost never fails the save).
      if (input.adoptedGhostId) {
        const inserted = await ghostCandidatesRepository.insertHighlightAdoptingGhost({
          ...insertParams,
          userId,
          ghostId: input.adoptedGhostId,
          enrichDebounceMs: ENRICH_DEBOUNCE_MS,
        })
        // A note typed in the main lane still seeds the chat (behind enrich).
        if (chatSeedPrompt) await enqueueSeedBestEffort(inserted.id)
        return { data: toHighlightDto(inserted) }
      }

      const inserted = await highlightsRepository.insertHighlight(insertParams)
      // Kick off background enrichment so the card is (almost) ready by the time
      // the user reaches the session vocabulary list. Debounced to absorb mis-selections; idempotent
      // per live job. Best-effort — a failed enqueue must not fail the highlight.
      try {
        await processingJobsRepository.enqueue({
          kind: 'enrich_highlight',
          sessionId: input.sessionId,
          highlightId: inserted.id,
          userId,
          runAfter: new Date(Date.now() + ENRICH_DEBOUNCE_MS),
        })
      } catch (error) {
        logWithSentry({
          message: 'enqueue enrich_highlight failed',
          params: { sessionId: input.sessionId, highlightId: inserted.id },
          error,
        })
      }
      // A note typed in the main lane still seeds the chat (behind enrich).
      if (chatSeedPrompt) await enqueueSeedBestEffort(inserted.id)
      return { data: toHighlightDto(inserted) }
    }),

    updateNoteAndTags: implementer.updateNoteAndTags.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      const existing = await highlightsRepository.findById(input.highlightId)
      if (!existing || existing.study_session_id !== input.sessionId) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Highlight not found' }] },
        })
      }
      const chatSeedPrompt = (input.chatSeedPrompt ?? '').trim() || null
      const updated = await highlightsRepository.updateNoteAndTags(
        input.highlightId,
        input.note,
        input.presetTags,
        chatSeedPrompt
      )
      if (!updated) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Highlight not found' }] },
        })
      }
      // A saved note/preset is answered in the card's chat, not baked into the
      // card fields. The frontend composed the localized question into
      // chatSeedPrompt; enqueue a seed_card_chat job to turn it into a chat turn +
      // reply. This path covers both a fresh highlight (whose enrich job is still
      // in flight) and reopening an old one (whose enrichment already ran and
      // won't re-fire). Debounced like enrich so the card is likely materialized
      // first; the worker retries if not. Best-effort — a failed enqueue must not
      // fail the save.
      if (chatSeedPrompt) {
        try {
          await processingJobsRepository.enqueueSeedCardChat({
            sessionId: input.sessionId,
            highlightId: input.highlightId,
            userId,
            runAfter: new Date(Date.now() + ENRICH_DEBOUNCE_MS),
          })
        } catch (error) {
          logWithSentry({
            message: 'enqueue seed_card_chat failed',
            params: { sessionId: input.sessionId, highlightId: input.highlightId },
            error,
          })
        }
      }
      return { data: toHighlightDto(updated) }
    }),

    updateStudyIntent: implementer.updateStudyIntent.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Study session not found' }] } })
      }
      const existing = await highlightsRepository.findById(input.highlightId)
      if (!existing || existing.study_session_id !== input.sessionId) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Highlight not found' }] } })
      }
      // Once the enrich job applied the intent the term has live facets — the
      // client must edit those, not this frozen column.
      if (existing.study_intent_applied_at) {
        throw errors.CONFLICT({ data: { errors: [{ message: 'Study intent already applied' }] } })
      }
      const updated = await highlightsRepository.updateStudyIntent(input.highlightId, input.studyIntent)
      // No row updated means the job applied the intent between the read and the
      // write (study_intent_applied_at IS NULL no longer holds) — same 409.
      if (!updated) {
        throw errors.CONFLICT({ data: { errors: [{ message: 'Study intent already applied' }] } })
      }
      return { data: toHighlightDto(updated) }
    }),

    // Upgrade a note-only stub into a full study card: persist the chosen study
    // intent, then run the normal enrichment. The enrich job RE-POINTS the
    // stub's still-needs_data card to the enriched lemma+sense lookup (see
    // insertCardForHighlightIdempotent) — same card row, so the existing note
    // and seeded chat survive; the card auto-keeps once basic data lands,
    // exactly like a full save.
    saveWord: implementer.saveWord.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Study session not found' }] } })
      }
      const existing = await highlightsRepository.findById(input.highlightId)
      if (!existing || existing.study_session_id !== input.sessionId) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Highlight not found' }] } })
      }
      // The applied_at-guarded update doubles as the stub check: once enrichment
      // applied an intent the word IS saved and there is nothing to upgrade.
      const updated = await highlightsRepository.updateStudyIntent(input.highlightId, input.studyIntent)
      if (!updated) {
        throw errors.CONFLICT({ data: { errors: [{ message: 'Word already saved' }] } })
      }
      // No debounce: unlike a fresh selection there is no mis-selection window
      // to absorb (the user explicitly confirmed), and the worker's existence
      // re-check already covers a delete racing the job. NOT best-effort — the
      // enqueue IS the upgrade, so a failure must surface for a retry.
      await processingJobsRepository.enqueue({
        kind: 'enrich_highlight',
        sessionId: input.sessionId,
        highlightId: input.highlightId,
        userId,
        runAfter: new Date(),
      })
      // The upgrade is committed — report the highlight as no longer note-only
      // so the client renders the normal saved state immediately.
      return { data: toHighlightDto(updated, { noteOnly: false }) }
    }),

    delete: implementer.delete.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      const existing = await highlightsRepository.findById(input.highlightId)
      if (!existing || existing.study_session_id !== input.sessionId) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Highlight not found' }] },
        })
      }
      // Transactional: drop the highlight's card (cards.highlight_id is ON DELETE
      // SET NULL, which would otherwise orphan it as a fake LLM suggestion) and
      // cascade away its enrich job, in one go.
      await highlightsRepository.deleteWithCardCleanup(input.highlightId)
      return { data: { id: input.highlightId } }
    }),

    fastGloss: implementer.fastGloss.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      const highlight = await highlightsRepository.findById(input.highlightId)
      if (!highlight || highlight.study_session_id !== input.sessionId) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Highlight not found' }] },
        })
      }
      // Pre-pick the dialect-correct display string server-side (same
      // convention as glosses.fastGloss); only English needs the pref read.
      const dialect =
        session.target_language === 'en' ? await usersRepository.getEnglishIpaDialect(userId) : ('ga' as const)
      const knownLemmaCandidates = await getKnownLemmaCandidates(
        { userId, targetLanguage: session.target_language, selectionText: highlight.selection_text },
        { wiktionaryMatchRepository, knownLemmasRepository }
      )
      if (highlight.fast_gloss) {
        const cachedGloss = parseFastGloss(highlight.fast_gloss)
        const ipaResult = await lookupFastGlossIpa({
          targetLanguage: session.target_language,
          selectionText: highlight.selection_text,
          pos: cachedGloss.pos,
          wiktionaryEntriesRepository,
        })
        const ipa = ipaResult?.ipa ?? null
        return {
          data: {
            ...cachedGloss,
            ipa,
            ipaDisplay: pickIpa(ipa, session.target_language, dialect) ?? null,
            ipaLemma: ipaResult?.lemma ?? null,
            knownLemmaCandidates,
          },
        }
      }
      const startSegment = await textSegmentsRepository.findById(highlight.start_segment_id)
      if (!startSegment) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Highlight start segment missing' }] },
        })
      }
      // Cross-segment highlight: the context line must cover the whole span,
      // not just the segment the selection started in.
      let contextLine = startSegment.text
      if (highlight.end_segment_id !== highlight.start_segment_id) {
        const endSegment = await textSegmentsRepository.findById(highlight.end_segment_id)
        if (endSegment) {
          const spanSegments = await textSegmentsRepository.listByIndexRange(
            session.text_track_id,
            Math.min(startSegment.index, endSegment.index),
            Math.max(startSegment.index, endSegment.index)
          )
          contextLine = spanSegments.map((s) => s.text).join(' ')
        }
      }
      const languagePrefs = await getLanguageMode({
        userId,
        targetLanguage: session.target_language,
        snapshotNativeLanguage: session.native_language,
        usersRepository,
        targetLanguagePrefsRepository,
      })
      const languageModeNativeLanguage = languagePrefs.nativeLanguage ?? session.target_language
      const gloss = await anthropicPasses.fastGlossPass({
        targetLanguage: session.target_language,
        nativeLanguage: languageModeNativeLanguage,
        hideTranslationFields: languagePrefs.hideTranslationFields,
        contextLine,
        selectionText: highlight.selection_text,
      })
      await highlightsRepository.updateFastGloss(highlight.id, serializeFastGloss(gloss))
      const ipaResult = await lookupFastGlossIpa({
        targetLanguage: session.target_language,
        selectionText: highlight.selection_text,
        pos: gloss.pos,
        wiktionaryEntriesRepository,
      })
      const ipa = ipaResult?.ipa ?? null
      return {
        data: {
          ...gloss,
          ipa,
          ipaDisplay: pickIpa(ipa, session.target_language, dialect) ?? null,
          ipaLemma: ipaResult?.lemma ?? null,
          knownLemmaCandidates,
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: highlightsContract })
}
