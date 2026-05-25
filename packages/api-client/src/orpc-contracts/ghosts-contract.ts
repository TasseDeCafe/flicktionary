import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { GhostCandidateSchema, HighlightSchema, NominatedWindowSchema } from './common/flicktionary-schemas'

export const ghostsContract = {
  // Live ghost candidates for the passive outline layer, plus the coverage set the
  // client seeds its requested-windows tracker from (so a reload resumes and never
  // re-requests a covered window).
  listBySession: oc
    .route({ method: 'GET', path: '/study-sessions/{sessionId}/ghosts', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          candidates: z.array(GhostCandidateSchema),
          windows: z.array(NominatedWindowSchema),
        }),
      })
    ),

  // Request nomination over a reading window. Idempotent per (session, window);
  // coverage and job enqueue are atomic so a covered window always has a job.
  nominateWindow: oc
    .route({ method: 'POST', path: '/study-sessions/{sessionId}/ghosts/nominate-window', successStatus: 202 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        startIndex: z.number().int().nonnegative(),
        endIndex: z.number().int().nonnegative(),
      })
    )
    .output(z.object({ data: z.object({ accepted: z.literal(true) }) })),

  // Atomic span swap: drop the provisional highlight the user's literal selection
  // created, create a highlight from the ghost's span, dismiss the ghost, and
  // enqueue enrichment for the new highlight — all in one transaction. Returns the
  // new highlight so the gloss sheet can re-point at it and reload.
  switch: oc
    .route({ method: 'POST', path: '/study-sessions/{sessionId}/ghosts/{ghostId}/switch', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        ghostId: z.string().uuid(),
        provisionalHighlightId: z.string().uuid(),
      })
    )
    .output(z.object({ data: HighlightSchema })),
} as const
