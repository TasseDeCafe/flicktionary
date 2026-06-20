import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { ghostsContract } from '@flicktionary/api-client/orpc-contracts/ghosts-contract'
import { StudyIntentSchema } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import {
  DbGhostCandidate,
  GhostCandidatesRepositoryInterface,
} from '../../transport/database/ghost-candidates/ghost-candidates-repository'
import {
  DbNominatedWindow,
  NominatedWindowsRepositoryInterface,
} from '../../transport/database/nominated-windows/nominated-windows-repository'
import { DbHighlight } from '../../transport/database/highlights/highlights-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'

// Same debounce as highlights.create — the adopted span goes through the identical
// background enrichment path.
const ENRICH_DEBOUNCE_MS = 5000

const toGhostDto = (row: DbGhostCandidate) => ({
  id: row.id,
  studySessionId: row.study_session_id,
  segmentId: row.segment_id,
  charStart: row.char_start,
  charEnd: row.char_end,
  surfaceForm: row.surface_form,
})

const toWindowDto = (row: DbNominatedWindow) => ({
  startIndex: row.start_index,
  endIndex: row.end_index,
  status: row.status as 'pending' | 'done' | 'failed',
})

const toHighlightDto = (row: DbHighlight) => {
  // A switch creates a brand-new highlight (pre-enrich), so chunkId is always
  // null here; study_intent is validated back to the contract shape (or null).
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
    chunkId: null,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export const GhostsRouter = (
  studySessionsRepository: StudySessionsRepositoryInterface,
  ghostCandidatesRepository: GhostCandidatesRepositoryInterface,
  nominatedWindowsRepository: NominatedWindowsRepositoryInterface,
  usersRepository: UsersRepositoryInterface
): Router => {
  const implementer = implement(ghostsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    listBySession: implementer.listBySession.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Study session not found' }] } })
      }
      const [candidates, windows] = await Promise.all([
        ghostCandidatesRepository.listLiveBySession(input.sessionId),
        nominatedWindowsRepository.listBySession(input.sessionId),
      ])
      return { data: { candidates: candidates.map(toGhostDto), windows: windows.map(toWindowDto) } }
    }),

    nominateWindow: implementer.nominateWindow.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Study session not found' }] } })
      }
      if (input.endIndex < input.startIndex) {
        return { data: { accepted: true as const } }
      }
      // Gate on the LLM-suggestions pref — the whole ghost layer is inert when off.
      const llmHighlightsEnabled = await usersRepository.getLlmHighlightsEnabled(userId)
      if (!llmHighlightsEnabled) {
        return { data: { accepted: true as const } }
      }
      // Idempotent and atomic: coverage row + worker job are created together, so
      // a window cannot get stuck as covered without a job.
      await nominatedWindowsRepository.requestWindowAndEnqueueJob({
        sessionId: input.sessionId,
        userId,
        startIndex: input.startIndex,
        endIndex: input.endIndex,
      })
      return { data: { accepted: true as const } }
    }),

    switch: implementer.switch.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Study session not found' }] } })
      }
      const result = await ghostCandidatesRepository.switchGhostToHighlight({
        sessionId: input.sessionId,
        ghostId: input.ghostId,
        provisionalHighlightId: input.provisionalHighlightId,
        userId,
        enrichDebounceMs: ENRICH_DEBOUNCE_MS,
      })
      if (result.kind === 'ghost_not_found') {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Ghost candidate not found or already adopted' }] } })
      }
      if (result.kind === 'provisional_not_found') {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Provisional highlight not found' }] } })
      }
      return { data: toHighlightDto(result.highlight) }
    }),
  })

  return createOrpcExpressRouter(router, { contract: ghostsContract })
}
