import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { GrammarIpaBagSchema, HighlightSchema, StudyIntentSchema } from './common/flicktionary-schemas'

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
        // See StudyIntentSchema: full-set facet configuration applied by the
        // enrichment job once the user_lookup materializes.
        studyIntent: StudyIntentSchema.optional(),
        // The selection was swapped to this ghost candidate's span pre-save:
        // dismiss the ghost in the same transaction as the highlight insert
        // (the pre-save sibling of ghosts.switch, which handles post-save).
        adoptedGhostId: z.string().uuid().optional(),
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
          ipa: GrammarIpaBagSchema.nullable(),
        }),
      })
    ),

  updateNoteAndTags: oc
    .route({ method: 'PUT', path: '/study-sessions/{sessionId}/highlights/{highlightId}/note', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        highlightId: z.string().uuid(),
        note: z.string().nullable(),
        presetTags: z.array(z.string()).default([]),
        // The localized, frontend-composed question seeded into the card chat
        // (selected presets rendered in the UI locale + the verbatim note). Null
        // when there is nothing to ask. The backend stores it verbatim and the
        // seed_card_chat worker uses it as the chat turn.
        chatSeedPrompt: z.string().nullable().optional(),
      })
    )
    .output(z.object({ data: HighlightSchema })),

  delete: oc
    .route({ method: 'DELETE', path: '/study-sessions/{sessionId}/highlights/{highlightId}', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid(), highlightId: z.string().uuid() }))
    .output(z.object({ data: z.object({ id: z.string().uuid() }) })),
} as const
