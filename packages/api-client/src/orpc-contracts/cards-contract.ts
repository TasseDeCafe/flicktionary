import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { CardSchema, CardStatusSchema } from './common/flicktionary-schemas'

export const cardsContract = {
  listBySession: oc
    .route({ method: 'GET', path: '/study-sessions/{sessionId}/cards', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
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

  // Bulk status update for triage's "Keep all" / "Reject all". Scoped to a
  // session so the SQL UPDATE can WHERE-filter on study_session_id and the
  // ownership check is a single lookup.
  updateStatusBatch: oc
    .route({ method: 'PATCH', path: '/study-sessions/{sessionId}/cards/status', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        cardIds: z.array(z.string().uuid()).min(1).max(500),
        status: CardStatusSchema,
      })
    )
    .output(z.object({ data: z.array(CardSchema) })),

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

  explore: oc
    .route({ method: 'POST', path: '/cards/{cardId}/explore', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ cardId: z.string().uuid() }))
    .output(z.object({ data: CardSchema })),

  // Card-level field patch. Vocabulary content (headword/sense/translation/
  // definition/examples/extras) lives on user_lookups now and is patched via
  // the chunks contract (chunks.updateChunkContent / chunks.renameChunk).
  updateFields: oc
    .route({ method: 'PATCH', path: '/cards/{cardId}/fields', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        cardId: z.string().uuid(),
        patch: z.object({
          surfaceForm: z.string().nullable().optional(),
        }),
      })
    )
    .output(z.object({ data: CardSchema })),
} as const
