import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { CardSchema, CardStatusSchema, StudyIntentSchema } from './common/flicktionary-schemas'

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
      // A data-less card (note-only stub with no translation/definition/example)
      // cannot be kept into Vocabulary/Practice — the user must generate its data
      // first (Generate full exploration / chat). Mirrors the floor-guard pattern.
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        cardId: z.string().uuid(),
        status: CardStatusSchema,
      })
    )
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

  // "Add a word" entry point. Creates (or reuses) a synthetic per-(user,
  // target_language) adhoc session in the background, generates one card via
  // a single basicDataPass call, runs Wiktionary grounding when available,
  // and returns the new cardId + sessionId so the client can navigate
  // straight to the focus view.
  //
  // BAD_REQUEST is overloaded with discriminated codes (`cefr_not_set`,
  // `native_language_not_set`) so the frontend can prompt for the missing
  // pref inline rather than blocking submit.
  createAdhoc: oc
    .route({ method: 'POST', path: '/cards/adhoc', successStatus: 200 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        targetLanguage: z.string().min(2).max(10),
        headword: z.string().trim().min(1).max(200),
        context: z.string().trim().max(2000).nullable(),
        // See StudyIntentSchema: full-set facet configuration, applied inline
        // (the adhoc save is synchronous) before the keep transition.
        studyIntent: StudyIntentSchema.optional(),
      })
    )
    .output(
      z.object({
        data: z.object({
          cardId: z.string().uuid(),
          sessionId: z.string().uuid(),
        }),
      })
    ),
} as const
