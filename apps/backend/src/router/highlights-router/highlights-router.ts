import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { highlightsContract } from '@flicktionary/api-client/orpc-contracts/highlights-contract'
import { DbHighlight, HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import {
  fastGlossPass,
  FastGloss,
  parseFastGlossText,
} from '../../transport/third-party/anthropic/passes/fast-gloss-pass'
import { getLanguageMode } from '../../service/user-prefs/language-mode'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { lookupFastGlossIpa } from '../../service/wiktionary-grounding/fast-gloss-ipa'

// fast_gloss is a single text column; we round-trip the {gloss, pos, register}
// triple as the same `<gloss>\n[POS]\n[register]` shape Haiku emits.
const serializeFastGloss = (g: FastGloss): string => `${g.gloss}\n${g.pos ?? ''}\n${g.register ?? ''}`

const parseFastGloss = (s: string): FastGloss => {
  return parseFastGlossText(s)
}

const toHighlightDto = (row: DbHighlight) => ({
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
  createdAt: new Date(row.created_at).toISOString(),
})

export const HighlightsRouter = (
  highlightsRepository: HighlightsRepositoryInterface,
  studySessionsRepository: StudySessionsRepositoryInterface,
  textSegmentsRepository: TextSegmentsRepositoryInterface,
  usersRepository: UsersRepositoryInterface,
  targetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface,
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface,
  processingJobsRepository: ProcessingJobsRepositoryInterface
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
      return { data: highlights.map(toHighlightDto) }
    }),

    create: implementer.create.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      const inserted = await highlightsRepository.insertHighlight({
        studySessionId: input.sessionId,
        startSegmentId: input.startSegmentId,
        endSegmentId: input.endSegmentId,
        startOffset: input.startOffset,
        endOffset: input.endOffset,
        selectionText: input.selectionText,
        note: input.note ?? null,
        presetTags: input.presetTags ?? [],
      })
      // Kick off background enrichment so the card is (almost) ready by the time
      // the user reaches triage. Debounced to absorb mis-selections; idempotent
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
      if (highlight.fast_gloss) {
        const cachedGloss = parseFastGloss(highlight.fast_gloss)
        const ipa = await lookupFastGlossIpa({
          targetLanguage: session.target_language,
          selectionText: highlight.selection_text,
          pos: cachedGloss.pos,
          wiktionaryEntriesRepository,
        })
        return { data: { ...cachedGloss, ipa } }
      }
      const startSegment = await textSegmentsRepository.findById(highlight.start_segment_id)
      if (!startSegment) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Highlight start segment missing' }] },
        })
      }
      const languagePrefs = await getLanguageMode({
        userId,
        targetLanguage: session.target_language,
        snapshotNativeLanguage: session.native_language,
        usersRepository,
        targetLanguagePrefsRepository,
      })
      const languageModeNativeLanguage = languagePrefs.nativeLanguage ?? session.target_language
      const gloss = await fastGlossPass({
        targetLanguage: session.target_language,
        nativeLanguage: languageModeNativeLanguage,
        hideTranslationFields: languagePrefs.hideTranslationFields,
        contextLine: startSegment.text,
        selectionText: highlight.selection_text,
      })
      await highlightsRepository.updateFastGloss(highlight.id, serializeFastGloss(gloss))
      const ipa = await lookupFastGlossIpa({
        targetLanguage: session.target_language,
        selectionText: highlight.selection_text,
        pos: gloss.pos,
        wiktionaryEntriesRepository,
      })
      return { data: { ...gloss, ipa } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: highlightsContract })
}
