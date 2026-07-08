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
        // Note-only lane ("ask a question, don't make a card"): when true the
        // highlight gets a synchronously-created empty stub card and seeds the
        // card chat from chatSeedPrompt — but NO basic-data pass / grounding /
        // study facets. The card is data-less until the user generates it. The
        // main lane (false/absent) keeps the full enrichment behavior.
        noteOnly: z.boolean().optional(),
        // The localized, frontend-composed question to seed into the card chat
        // (selected presets rendered in the UI locale + the verbatim note).
        // Same shape/semantics as updateNoteAndTags's. In the main lane this
        // additionally enqueues a seed_card_chat job behind enrichment.
        chatSeedPrompt: z.string().nullable().optional(),
        // See StudyIntentSchema: full-set facet configuration applied by the
        // enrichment job once the user_lookup materializes. Ignored in the
        // note-only lane (no enrichment runs).
        studyIntent: StudyIntentSchema.optional(),
        // Preview gloss already shown to the user before Save. When present,
        // persist it so saved-mode display does not run a second first-gloss
        // pass that can infer slightly different metadata.
        fastGloss: z
          .object({
            gloss: z.string(),
            pos: z.string().nullable(),
            register: z.string().nullable(),
          })
          .optional(),
        // The selection was swapped to this ghost candidate's span pre-save:
        // dismiss the ghost in the same transaction as the highlight insert
        // (the pre-save sibling of ghosts.switch, which handles post-save).
        adoptedGhostId: z.string().uuid().optional(),
      })
    )
    .output(z.object({ data: HighlightSchema })),

  fastGloss: oc
    .route({
      method: 'POST',
      path: '/study-sessions/{sessionId}/highlights/{highlightId}/fast-gloss',
      successStatus: 200,
    })
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
          // Server-picked, dialect-correct display string — see
          // glosses-contract's fastGloss output for the convention.
          ipaDisplay: z.string().nullable(),
          // Lemma the IPA was sourced from on form-of fallback — see
          // glosses-contract's fastGloss output for the convention.
          ipaLemma: z.string().nullable(),
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

  updateStudyIntent: oc
    .route({
      method: 'PUT',
      path: '/study-sessions/{sessionId}/highlights/{highlightId}/study-intent',
      successStatus: 200,
    })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      // The enrich job already applied the intent — the term now has live facets,
      // so the client must edit those instead of the stored intent.
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        highlightId: z.string().uuid(),
        // `null` CLEARS the stored intent (back to zero pre-configured skills) —
        // StudyIntentSchema is `.min(1)`, so "no skills" can't be an empty set.
        studyIntent: StudyIntentSchema.nullable(),
      })
    )
    .output(z.object({ data: HighlightSchema })),

  // Upgrade a note-only stub into a full study card ("save the word after all"):
  // persists the chosen study intent on the highlight and enqueues the normal
  // enrich_highlight job — the stub card fills in place (idempotent card insert),
  // the existing note/chat are untouched, and the card auto-keeps once basic
  // data lands. Only valid while the highlight is still a stub (intent not yet
  // applied); afterwards the word IS saved and there is nothing to upgrade.
  saveWord: oc
    .route({
      method: 'POST',
      path: '/study-sessions/{sessionId}/highlights/{highlightId}/save-word',
      successStatus: 200,
    })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      // The intent was already applied (the word is already saved) — nothing to
      // upgrade; the client should refetch and render the normal saved state.
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        highlightId: z.string().uuid(),
        // Untouched study options → null → the backend keep-time default
        // applies (same semantics as create's optional studyIntent).
        studyIntent: StudyIntentSchema.nullable(),
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
