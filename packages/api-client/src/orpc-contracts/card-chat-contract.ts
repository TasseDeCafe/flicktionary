import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { CardChatMessageSchema } from './common/flicktionary-schemas'

export const cardChatContract = {
  listForCard: oc
    .route({ method: 'GET', path: '/cards/{cardId}/chat', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ cardId: z.string().uuid() }))
    .output(z.object({ data: z.array(CardChatMessageSchema) })),

  sendMessage: oc
    .route({ method: 'POST', path: '/cards/{cardId}/chat', successStatus: 201 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ cardId: z.string().uuid(), content: z.string().min(1) }))
    .output(
      z.object({
        data: z.object({
          userMessage: CardChatMessageSchema,
          assistantMessage: CardChatMessageSchema,
        }),
      })
    ),
} as const
