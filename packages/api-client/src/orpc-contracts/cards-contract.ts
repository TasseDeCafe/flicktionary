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

  // Remove (unkeep) a card from its session vocabulary list. Sets status to
  // `removed`: non-destructive — it decrements user_lookups.count only if the
  // card was kept, never sets deleted_at, and the term survives in Vocabulary if
  // kept elsewhere. Term-level deletion is chunks.deleteChunk. There is no
  // generic status mutation: cards keep themselves automatically once they gain
  // basic data, so the only user-driven transition is removal.
  removeFromSession: oc
    .route({ method: 'PATCH', path: '/cards/{cardId}/remove-from-session', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ cardId: z.string().uuid() }))
    .output(z.object({ data: CardSchema })),

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
