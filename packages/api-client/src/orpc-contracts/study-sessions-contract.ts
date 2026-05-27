import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { StudySessionSchema } from './common/flicktionary-schemas'

export const studySessionsContract = {
  list: oc
    .route({ method: 'GET', path: '/study-sessions', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .output(z.object({ data: z.array(StudySessionSchema) })),

  get: oc
    .route({ method: 'GET', path: '/study-sessions/{sessionId}', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ data: StudySessionSchema })),

  create: oc
    .route({ method: 'POST', path: '/study-sessions', successStatus: 201 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        contentSourceId: z.string().uuid(),
        textTrackId: z.string().uuid(),
        nativeLanguage: z.string(),
        targetLanguage: z.string(),
        cefrLevel: z.string(),
      })
    )
    .output(z.object({ data: StudySessionSchema })),

  process: oc
    .route({ method: 'POST', path: '/study-sessions/{sessionId}/process', successStatus: 202 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ data: z.object({ accepted: z.literal(true) }) })),

  // Resume-reading position: record the deepest segment the reader has reached so
  // reopening the session can land them back there. Fire-and-forget from the client
  // (throttled); the server keeps it monotonic via GREATEST.
  updateReadingProgress: oc
    .route({ method: 'POST', path: '/study-sessions/{sessionId}/reading-progress', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid(), segmentIndex: z.number().int().nonnegative() }))
    .output(z.object({ data: z.object({ ok: z.literal(true) }) })),

  getStatus: oc
    .route({ method: 'GET', path: '/study-sessions/{sessionId}/status', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          processingWarnings: z.array(z.string()),
        }),
      })
    ),

  // Triage loaders: which highlights still have an enrich job in flight, and
  // which failed (retry affordance).
  getProcessingStatus: oc
    .route({ method: 'GET', path: '/study-sessions/{sessionId}/processing-status', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          enrichingHighlightIds: z.array(z.string().uuid()),
          failedHighlightIds: z.array(z.string().uuid()),
          // Highlights whose saved note/preset is being answered in the card chat
          // (pending/processing), and those whose seed job parked as failed. Kept
          // separate from enriching/failed so a pending answer is not mistaken for
          // a missing card in triage.
          seedChatHighlightIds: z.array(z.string().uuid()),
          failedSeedChatHighlightIds: z.array(z.string().uuid()),
        }),
      })
    ),

  // Re-enqueue a failed per-highlight enrichment job.
  retryEnrichment: oc
    .route({ method: 'POST', path: '/study-sessions/{sessionId}/retry-enrichment', successStatus: 202 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid(), highlightId: z.string().uuid() }))
    .output(z.object({ data: z.object({ accepted: z.literal(true) }) })),

  // Counts for the Remove confirmation dialog.
  getDeletePreview: oc
    .route({ method: 'GET', path: '/study-sessions/{sessionId}/delete-preview', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          highlightCount: z.number().int(),
          cardCount: z.number().int(),
          keptCardCount: z.number().int(),
        }),
      })
    ),

  // Soft-delete: hides the session from the user's list but keeps the underlying
  // content (cards, segments, content_source) so kept vocabulary can still
  // back-link to its source. Hard erasure is via account deletion.
  remove: oc
    .route({ method: 'DELETE', path: '/study-sessions/{sessionId}', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ data: z.object({ ok: z.literal(true) }) })),
} as const
