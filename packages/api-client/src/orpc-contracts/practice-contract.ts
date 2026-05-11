import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import {
  PracticeDueSummaryEntrySchema,
  PracticeRatingSchema,
  PracticeSessionProgressSchema,
  PracticeSessionSchema,
  PracticeTextSchema,
} from './common/flicktionary-schemas'

export const practiceContract = {
  // Per-language summary used by the Practice landing. Returns one row per
  // target_language the user has cards in, with daily review, intraday
  // learning follow-up, new, and total counts.
  dueSummary: oc
    .route({ method: 'GET', path: '/practice/due-summary', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({}))
    .output(z.object({ data: z.object({ perLanguage: z.array(PracticeDueSummaryEntrySchema) }) })),

  // Resume-or-create. `resumed: true` means the caller is being handed an
  // already-active session for this (user, target_language). The membership
  // snapshot only gets created when a fresh session is inserted.
  startSession: oc
    .route({ method: 'POST', path: '/practice/sessions', successStatus: 201 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ targetLanguage: z.string().min(1) }))
    .output(z.object({ data: z.object({ sessionId: z.string().uuid(), resumed: z.boolean() }) })),

  // Loads the practice_session + the most recent readable practice_text (if
  // any). Used to bootstrap the session view on mount and to resume an
  // in-progress session. The currentText (if returned) is server-side
  // transitioned to status='reading'; closing and reopening the modal
  // therefore lands on the same text rather than a successor pre-gen slot.
  getSession: oc
    .route({ method: 'GET', path: '/practice/sessions/{sessionId}', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          session: PracticeSessionSchema,
          currentText: PracticeTextSchema.nullable(),
          progress: PracticeSessionProgressSchema,
        }),
      })
    ),

  // Generates the next practice_text for a session — or returns done=true if
  // there are no more due chunks not yet covered. Foreground path: returns
  // an already-generated 'ready' slot instantly when one is queued, otherwise
  // generates synchronously (with a 30s poll-and-takeover for slots a pre-gen
  // worker is currently producing).
  generateNextText: oc
    .route({ method: 'POST', path: '/practice/sessions/{sessionId}/next-text', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(
      z.object({
        data: z.union([
          z.object({
            done: z.literal(false),
            practiceText: PracticeTextSchema,
            progress: PracticeSessionProgressSchema,
          }),
          z.object({ done: z.literal(true), progress: PracticeSessionProgressSchema }),
        ]),
      })
    ),

  // Background pre-generation. Reserves the next slot if one is needed and
  // kicks off LLM work in a detached promise. Never marks the session
  // completed even if the chunk pool is empty (that's reserved for the
  // foreground generateNextText after finalize). Returns the slot's current
  // status so the client can observe pre-gen progress if it cares.
  prepareNextText: oc
    .route({ method: 'POST', path: '/practice/sessions/{sessionId}/prepare-next-text', successStatus: 202 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(
      z.object({
        data: z.union([
          z.object({ status: z.literal('queued'), practiceTextId: z.string().uuid() }),
          z.object({ status: z.literal('already_ready'), practiceTextId: z.string().uuid() }),
          z.object({ status: z.literal('already_generating'), practiceTextId: z.string().uuid() }),
          z.object({ status: z.literal('no_work') }),
        ]),
      })
    ),

  // Explicit rating — fires when the user taps a chunk and picks a rating in
  // the rate sheet. wasExplicit=true server-side; the implicit-good ratings
  // applied on session-advance are written by finalizeText. Returns the
  // updated session progress so the bar moves on rating, not just on Next.
  rateChunk: oc
    .route({ method: 'POST', path: '/practice/texts/{textId}/ratings', successStatus: 201 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        textId: z.string().uuid(),
        headword: z.string(),
        sense: z.string(),
        rating: PracticeRatingSchema,
      })
    )
    .output(
      z.object({
        data: z.object({ accepted: z.literal(true), progress: PracticeSessionProgressSchema }),
      })
    ),

  // User pressed Next: every annotation that wasn't explicitly rated gets an
  // implicit-good. The text moves to status='done'.
  finalizeText: oc
    .route({ method: 'POST', path: '/practice/texts/{textId}/finalize', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ textId: z.string().uuid() }))
    .output(z.object({ data: z.object({ implicitGoodCount: z.number().int() }) })),
} as const
