import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { CardChatMessageSchema, ChunkSchema } from './common/flicktionary-schemas'

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
          // The chunk as it stands after this turn's update_card_fields tool
          // patch, when the assistant applied one — null for purely
          // conversational turns. Lets the client reconcile embedded chunk
          // copies (e.g. a stashed practice session) without a refetch.
          updatedChunk: ChunkSchema.nullable(),
        }),
      })
    ),

  // Mark a card's chat as read up to now. Idempotent upsert on the server,
  // so the client fires it freely (on panel open, and whenever a fresh
  // assistant turn lands while the panel is open).
  markRead: oc
    .route({ method: 'PATCH', path: '/cards/{cardId}/chat/read', successStatus: 200 })
    .errors({ NOT_FOUND: { status: 404, data: BackendErrorResponseSchema } })
    .input(z.object({ cardId: z.string().uuid() }))
    .output(z.object({ data: z.object({ ok: z.literal(true) }) })),
} as const
