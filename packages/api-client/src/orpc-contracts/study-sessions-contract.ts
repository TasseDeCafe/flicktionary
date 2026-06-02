import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { StudySessionSchema, TextSegmentSchema } from './common/flicktionary-schemas'

// Payload caps for the extension ingestion endpoints (YouTube + streaming).
// Most user-visible subtitles fit well under both limits; outliers (very long
// lectures, dense karaoke captions) route through the existing text-tracks
// upload pipeline.
const EXTENSION_MAX_SEGMENTS = 2000

const ExtensionSubtitleSegmentSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
})

const ExtensionSubtitlePayloadSchema = z.object({
  // No language field: the backend detects the language from the segment text
  // (languageDetectionPass) and uses it as the content language AND the session
  // target language. This is the single source of truth — the extension can no
  // longer mislabel a track (see UNSUPPORTED_LANGUAGE below).
  segments: z.array(ExtensionSubtitleSegmentSchema).max(EXTENSION_MAX_SEGMENTS),
  // sha256 of the canonical segments JSON the extension actually rendered.
  // Same hash → same text_track row (idempotent re-register on reload). For the
  // streaming flow this hash is ALSO the content_source natural key.
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
  // re-invoking with the same (user, videoId, hash) returns the same
  // session/track. A different `subtitles.contentHash` produces a new
  // text_track + session.
  //
  // Language is detected server-side from the segment text and used as both the
  // content language and the session target language (a Russian-subtitle video
  // becomes a Russian session). The extension sends no language at all.
  //
  // The extension sends pre-parsed, filter-applied, offset-corrected segments
  // (verbatim from `subtitleController.subtitles`) — the backend stores them
  // unmodified into text_segments. native_language and cefr_level are resolved
  // server-side from user_prefs; UNPROCESSABLE_ENTITY is returned with code
  // 'MISSING_CEFR' when prefs are incomplete for the detected language, or
  // 'UNSUPPORTED_LANGUAGE' when the subtitles aren't in a supported language
  // (the extension shows the appropriate message and disables saving).
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
        subtitles: ExtensionSubtitlePayloadSchema,
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

  // Streaming-site ingestion (Netflix, Prime, …) used by the browser extension.
  // Same idempotent contract as the YouTube endpoint, but the content is keyed
  // by the subtitle contentHash (no stable per-site video id is parsed): the
  // hash is both the text_track hash AND the content_source natural key. Title
  // is the page title; videoUrl is the page URL (display/back-link only).
  // Language is still detected server-side from the segment text and used as the
  // content + session target language; UNPROCESSABLE_ENTITY with 'MISSING_CEFR'
  // / 'UNSUPPORTED_LANGUAGE' is returned exactly as in the YouTube flow.
  findOrCreateForStreamingVideo: oc
    .route({
      method: 'POST',
      path: '/study-sessions/find-or-create-for-streaming-video',
      successStatus: 200,
    })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        videoTitle: z.string().min(1),
        videoUrl: z.string().url(),
        subtitles: ExtensionSubtitlePayloadSchema,
      })
    )
    .output(
      z.object({
        data: z.object({
          sessionId: z.string().uuid(),
          textTrackId: z.string().uuid(),
          contentSourceId: z.string().uuid(),
          segments: z.array(TextSegmentSchema),
        }),
      })
    ),

  // Text-import entry point used by the browser extension: a Readability-extracted
  // article (sourceUrl set → content_source type 'article') or an arbitrary text
  // selection (no sourceUrl → type 'text', semantically a paste). Idempotent by the
  // hash of the parsed text: re-importing the same body returns the same
  // session/track. Like the video flows, language is detected server-side and used
  // as both the content language and the session target language — the extension
  // sends no language. UNPROCESSABLE_ENTITY carries 'UNSUPPORTED_LANGUAGE' (e.g. a
  // selection too short to detect) or 'MISSING_CEFR' exactly as the video flows do.
  //
  // The text bound is larger than the web app's paste wizard (20k): a full news
  // article routinely runs longer, and this text arrives machine-extracted rather
  // than hand-pasted.
  importText: oc
    .route({ method: 'POST', path: '/study-sessions/import-text', successStatus: 200 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        text: z.string().min(1).max(100_000),
        // Present for Readability article extraction (back-link + 'article' type);
        // absent for a bare text selection (treated as a paste, type 'text').
        sourceUrl: z.string().url().optional(),
      })
    )
    .output(
      z.object({
        data: z.object({
          sessionId: z.string().uuid(),
          contentSourceId: z.string().uuid(),
          textTrackId: z.string().uuid(),
          segmentCount: z.number().int(),
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
