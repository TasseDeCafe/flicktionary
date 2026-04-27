import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { CardSchema, CardStatusSchema } from './common/flicktionary-schemas'

export const cardsContract = {
  listBySession: oc
    .route({ method: 'GET', path: '/study-sessions/{sessionId}/cards', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        status: CardStatusSchema.optional(),
      })
    )
    .output(z.object({ data: z.array(CardSchema) })),

  get: oc
    .route({ method: 'GET', path: '/cards/{cardId}', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ cardId: z.string().uuid() }))
    .output(z.object({ data: CardSchema })),

  updateStatus: oc
    .route({ method: 'PATCH', path: '/cards/{cardId}/status', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ cardId: z.string().uuid(), status: CardStatusSchema }))
    .output(z.object({ data: CardSchema })),

  updateOverrides: oc
    .route({ method: 'PATCH', path: '/cards/{cardId}/overrides', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        cardId: z.string().uuid(),
        frontOverride: z.string().nullable(),
        backOverride: z.string().nullable(),
      })
    )
    .output(z.object({ data: CardSchema })),

  exportCsv: oc
    .route({ method: 'POST', path: '/study-sessions/{sessionId}/export', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          csv: z.string(),
          cardCount: z.number().int(),
        }),
      })
    ),
} as const
