import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { TextSegmentSchema } from './common/flicktionary-schemas'

export const textSegmentsContract = {
  listByTrack: oc
    .route({ method: 'GET', path: '/text-tracks/{textTrackId}/segments', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ textTrackId: z.string().uuid() }))
    .output(z.object({ data: z.array(TextSegmentSchema) })),

  search: oc
    .route({ method: 'GET', path: '/text-tracks/{textTrackId}/segments/search', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ textTrackId: z.string().uuid(), q: z.string().min(1) }))
    .output(z.object({ data: z.array(TextSegmentSchema) })),
} as const
