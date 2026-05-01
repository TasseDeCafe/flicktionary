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

  getWindow: oc
    .route({ method: 'GET', path: '/text-tracks/{textTrackId}/segments/window', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(
      z.object({
        textTrackId: z.string().uuid(),
        segmentId: z.string().uuid(),
        // GET query params arrive as strings; coerce so the URL ?radius=2 round-trips correctly.
        radius: z.coerce.number().int().min(0).max(50),
      })
    )
    .output(z.object({ data: z.array(TextSegmentSchema), centerSegmentId: z.string().uuid() })),
} as const
