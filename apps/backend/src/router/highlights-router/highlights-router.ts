import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { highlightsContract } from '@flicktionary/api-client/orpc-contracts/highlights-contract'
import { DbHighlight, HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { fastGlossPass, FastGloss } from '../../transport/third-party/anthropic/passes/fast-gloss-pass'

// fast_gloss is a single text column; we round-trip the {gloss, pos, register}
// triple as the same `<gloss>\n[POS]\n[register]` shape Haiku emits.
const serializeFastGloss = (g: FastGloss): string => `${g.gloss}\n${g.pos ?? ''}\n${g.register ?? ''}`

const parseFastGloss = (s: string): FastGloss => {
  const lines = s.split(/\r?\n/)
  return {
    gloss: lines[0] ?? '',
    pos: lines[1]?.trim() || null,
    register: lines[2]?.trim() || null,
  }
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
  textSegmentsRepository: TextSegmentsRepositoryInterface
): Router => {
  const implementer = implement(highlightsContract).$context<OrpcContext>()

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
      if (!inserted) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to create highlight' }] },
        })
      }
      return { data: toHighlightDto(inserted) }
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
        return { data: parseFastGloss(highlight.fast_gloss) }
      }
      const startSegment = await textSegmentsRepository.findById(highlight.start_segment_id)
      if (!startSegment) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Highlight start segment missing' }] },
        })
      }
      const gloss = await fastGlossPass({
        targetLanguage: session.target_language,
        nativeLanguage: session.native_language,
        contextLine: startSegment.text,
        selectionText: highlight.selection_text,
      })
      await highlightsRepository.updateFastGloss(highlight.id, serializeFastGloss(gloss))
      return { data: gloss }
    }),
  })

  return createOrpcExpressRouter(router, { contract: highlightsContract })
}
