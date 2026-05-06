import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import {
  PracticeDueSummaryEntrySchema,
  PracticeRatingSchema,
  PracticeSessionSchema,
  PracticeTextSchema,
} from './common/flicktionary-schemas'

export const practiceContract = {
  // Per-language summary used by the Practice landing. Returns one row per
  // target_language the user has cards in, with total / due / new counts.
  dueSummary: oc
    .route({ method: 'GET', path: '/practice/due-summary', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({}))
    .output(z.object({ data: z.object({ perLanguage: z.array(PracticeDueSummaryEntrySchema) }) })),

  startSession: oc
    .route({ method: 'POST', path: '/practice/sessions', successStatus: 201 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ targetLanguage: z.string().min(1) }))
    .output(z.object({ data: z.object({ sessionId: z.string().uuid() }) })),

  // Loads the practice_session + the most recent readable practice_text (if
  // any). Used to bootstrap the session view on mount and to resume an
  // in-progress session.
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
        }),
      })
    ),

  // Generates the next practice_text for a session — or returns done=true if
  // there are no more due chunks not yet covered. Synchronous in MVP (waits
  // for Anthropic streaming.finalMessage); v2 may move to fire-and-forget.
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
          z.object({ done: z.literal(false), practiceText: PracticeTextSchema }),
          z.object({ done: z.literal(true) }),
        ]),
      })
    ),

  // Explicit rating — fires when the user taps a chunk and picks a rating in
  // the rate sheet. wasExplicit=true server-side; the implicit-good ratings
  // applied on session-advance are written by finalizeText.
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
    .output(z.object({ data: z.object({ accepted: z.literal(true) }) })),

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
