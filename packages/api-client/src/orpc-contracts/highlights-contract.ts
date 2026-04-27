import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { HighlightSchema } from './common/flicktionary-schemas'

export const highlightsContract = {
  listBySession: oc
    .route({ method: 'GET', path: '/study-sessions/{sessionId}/highlights', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ data: z.array(HighlightSchema) })),

  create: oc
    .route({ method: 'POST', path: '/study-sessions/{sessionId}/highlights', successStatus: 201 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        startSegmentId: z.string().uuid(),
        endSegmentId: z.string().uuid(),
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().nonnegative(),
        selectionText: z.string().min(1),
        note: z.string().nullable().optional(),
        presetTags: z.array(z.string()).default([]),
      })
    )
    .output(z.object({ data: HighlightSchema })),

  fastGloss: oc
    .route({ method: 'POST', path: '/study-sessions/{sessionId}/highlights/{highlightId}/fast-gloss', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid(), highlightId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          gloss: z.string(),
          pos: z.string().nullable(),
          register: z.string().nullable(),
        }),
      })
    ),
} as const
