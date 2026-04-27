import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { textSegmentsContract } from '@flicktionary/api-client/orpc-contracts/text-segments-contract'
import {
  TextSegmentsRepositoryInterface,
  DbTextSegment,
} from '../../transport/database/text-segments/text-segments-repository'
import { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'

const toSegmentDto = (row: DbTextSegment) => ({
  id: row.id,
  index: row.index,
  text: row.text,
  startMs: row.start_ms,
  endMs: row.end_ms,
})

export const TextSegmentsRouter = (
  textTracksRepository: TextTracksRepositoryInterface,
  textSegmentsRepository: TextSegmentsRepositoryInterface
): Router => {
  const implementer = implement(textSegmentsContract).$context<OrpcContext>()

  const router = implementer.router({
    listByTrack: implementer.listByTrack.handler(async ({ input }) => {
      const segments = await textSegmentsRepository.listByTrackId(input.textTrackId)
      return { data: segments.map(toSegmentDto) }
    }),

    search: implementer.search.handler(async ({ input, errors }) => {
      const track = await textTracksRepository.findById(input.textTrackId)
      if (!track) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Text track not found' }] },
        })
      }
      const segments = await textSegmentsRepository.searchInTrack(input.textTrackId, track.language, input.q)
      return { data: segments.map(toSegmentDto) }
    }),
  })

  return createOrpcExpressRouter(router, { contract: textSegmentsContract })
}
