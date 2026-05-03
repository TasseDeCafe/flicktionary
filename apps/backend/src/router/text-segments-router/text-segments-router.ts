import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { textSegmentsContract } from '@flicktionary/api-client/orpc-contracts/text-segments-contract'
import {
  TextSegmentsRepositoryInterface,
  DbTextSegment,
} from '../../transport/database/text-segments/text-segments-repository'
import { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'

const toSegmentDto = (row: DbTextSegment) => ({
  id: row.id,
  index: row.index,
  text: row.text,
  startMs: row.start_ms,
  endMs: row.end_ms,
})

export const TextSegmentsRouter = (
  textTracksRepository: TextTracksRepositoryInterface,
  textSegmentsRepository: TextSegmentsRepositoryInterface,
  studySessionsRepository: StudySessionsRepositoryInterface
): Router => {
  const implementer = implement(textSegmentsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const assertUserCanReadTrack = async (textTrackId: string, userId: string, throwNotFound: () => never) => {
    const canRead = await studySessionsRepository.hasTextTrackForUser(textTrackId, userId)
    if (!canRead) {
      throwNotFound()
    }
  }

  const router = implementer.router({
    listByTrack: implementer.listByTrack.handler(async ({ input, context, errors }) => {
      await assertUserCanReadTrack(input.textTrackId, context.res.locals.userId, () => {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Text track not found' }] },
        })
      })
      const segments = await textSegmentsRepository.listByTrackId(input.textTrackId)
      return { data: segments.map(toSegmentDto) }
    }),

    search: implementer.search.handler(async ({ input, context, errors }) => {
      await assertUserCanReadTrack(input.textTrackId, context.res.locals.userId, () => {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Text track not found' }] },
        })
      })
      const track = await textTracksRepository.findById(input.textTrackId)
      if (!track) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Text track not found' }] },
        })
      }
      const segments = await textSegmentsRepository.searchInTrack(input.textTrackId, track.language, input.q)
      return { data: segments.map(toSegmentDto) }
    }),

    getWindow: implementer.getWindow.handler(async ({ input, context, errors }) => {
      await assertUserCanReadTrack(input.textTrackId, context.res.locals.userId, () => {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Text track not found' }] },
        })
      })
      const center = await textSegmentsRepository.findById(input.segmentId)
      if (!center || center.text_track_id !== input.textTrackId) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Segment not found in track' }] },
        })
      }
      const segments = await textSegmentsRepository.listAroundIndex(input.textTrackId, center.index, input.radius)
      return { data: segments.map(toSegmentDto), centerSegmentId: center.id }
    }),
  })

  return createOrpcExpressRouter(router, { contract: textSegmentsContract })
}
