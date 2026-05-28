import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { StudySessionSchema, TextSegmentSchema } from './common/flicktionary-schemas'

// Payload caps for the YouTube ingestion endpoint. Most user-visible YouTube
// subtitles fit well under both limits; outliers (very long lectures, dense
// karaoke captions) route through the existing text-tracks upload pipeline.
const YOUTUBE_MAX_SEGMENTS = 2000

const YoutubeSubtitleSegmentSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
})

const YoutubeSubtitlePayloadSchema = z.object({
  language: z.string().min(1),
  segments: z.array(YoutubeSubtitleSegmentSchema).max(YOUTUBE_MAX_SEGMENTS),
  // sha256 of the canonical segments JSON the extension actually rendered.
  // Same hash → same text_track row (idempotent re-register on reload).
  contentHash: z.string().min(1),
})

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

  // YouTube ingestion entry point used by the browser extension. Idempotent:
  // re-invoking with the same (user, videoId, hash, targetLanguage) returns the
  // same session/track. A different `targetLanguage` against the same video
  // creates a sibling session under the same content_source/text_track; a
  // different `subtitles.contentHash` produces a new text_track + session.
  //
  // The extension sends pre-parsed, filter-applied, offset-corrected segments
  // (verbatim from `subtitleController.subtitles`) — the backend stores them
  // unmodified into text_segments. native_language and cefr_level are resolved
  // server-side from user_prefs; UNPROCESSABLE_ENTITY with code 'MISSING_CEFR'
  // is returned when prefs are incomplete (extension shows "Finish setup").
  findOrCreateForYoutubeVideo: oc
    .route({
      method: 'POST',
      path: '/study-sessions/find-or-create-for-youtube-video',
      successStatus: 200,
    })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        youtubeVideoId: z.string().min(1),
        videoTitle: z.string().min(1),
        videoUrl: z.string().url(),
        videoAudioLanguage: z.string().min(1),
        targetLanguage: z.string().min(1),
        subtitles: YoutubeSubtitlePayloadSchema,
      })
    )
    .output(
      z.object({
        data: z.object({
          sessionId: z.string().uuid(),
          textTrackId: z.string().uuid(),
          contentSourceId: z.string().uuid(),
          // Full segment list so the extension can resolve a clicked
          // segment-index → text_segments.id without per-highlight round trips.
          segments: z.array(TextSegmentSchema),
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
