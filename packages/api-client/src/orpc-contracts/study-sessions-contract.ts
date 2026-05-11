import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { StudySessionSchema, StudySessionStatusSchema } from './common/flicktionary-schemas'

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
          status: StudySessionStatusSchema,
          processingWarnings: z.array(z.string()),
          processedAt: z.string().nullable(),
        }),
      })
    ),

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
          status: StudySessionStatusSchema,
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
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ data: z.object({ ok: z.literal(true) }) })),
} as const
