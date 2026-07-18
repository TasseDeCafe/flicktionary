import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { StudySessionSchema, TextSegmentSchema } from './common/flicktionary-schemas'

// Payload caps for the extension ingestion endpoints (YouTube + streaming).
// Most user-visible subtitles fit well under both limits; outliers (very long
// lectures, dense karaoke captions) route through the existing text-tracks
// upload pipeline.
const EXTENSION_MAX_SEGMENTS = 10000

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

  // Checkpoint reviews ("I've followed up to here") — see docs/SRS.md
  // "Checkpoint reviews". Counts what a collect up to `toSegmentIndex` would
  // credit. Read-only and body-less, so it cannot see the client's ephemeral
  // previewed-gloss spans — a slight overcount vs the collect result is
  // accepted (the toast shows the real number). Multi-sense headwords are also
  // counted optimistically (no LLM on the preview path). `backlogCount` is
  // reported separately so the UI can offer the claims flow even when
  // pendingCount is 0. `supported` = the session's target language has
  // wiktionary data loaded (KAIKKI_LANGUAGES); when false both counts are 0
  // and the UI hides the checkpoint affordances.
  getCheckpointPreview: oc
    .route({ method: 'GET', path: '/study-sessions/{sessionId}/checkpoint-preview', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid(), toSegmentIndex: z.coerce.number().int().nonnegative() }))
    .output(
      z.object({
        data: z.object({
          pendingCount: z.number().int(),
          backlogCount: z.number().int(),
          supported: z.boolean(),
        }),
      })
    ),

  // The checkpoint press: credit implicit `good` ratings to saved due terms in
  // the span (reviewedUntil, toSegmentIndex], advance the monotonic pointer,
  // and return the backlog known-assertion candidates for the claims sheet.
  // `previewedSpans` is the client-tracked list of preview-gloss selections
  // (the server stores nothing for preview glosses) — matched terms there are
  // suppressed, never converted to a worse rating. `checkpointId: null` means
  // the span was empty and nothing was written. CONFLICT = a concurrent press
  // advanced the pointer first; the client refetches and retries.
  // UNPROCESSABLE_ENTITY carries code 'UNSUPPORTED_LANGUAGE' when the
  // session's language has no wiktionary data.
  collectCheckpoint: oc
    .route({ method: 'POST', path: '/study-sessions/{sessionId}/checkpoints', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
      UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        toSegmentIndex: z.number().int().nonnegative(),
        previewedSpans: z
          .array(
            z.object({
              segmentIndex: z.number().int().nonnegative(),
              selectionText: z.string().max(200),
            })
          )
          .max(500),
      })
    )
    .output(
      z.object({
        data: z.object({
          checkpointId: z.string().uuid().nullable(),
          fromSegmentIndex: z.number().int().nullable(),
          toSegmentIndex: z.number().int(),
          creditedCount: z.number().int(),
          suppressedCount: z.number().int(),
          backlogCandidates: z.array(
            z.object({
              userLookupId: z.string().uuid(),
              headword: z.string(),
              sense: z.string(),
            })
          ),
        }),
      })
    ),

  // Batch undo of one checkpoint's implicit credits. Only the session's latest
  // LIVE checkpoint may be undone (`undone: false` otherwise — a stale-safe
  // no-op, never an error). Facets rated again after the checkpoint are
  // skipped (`skipped`), the rest restore their snapshots (`reverted`); the
  // reviewed-until pointer returns to the checkpoint's from value (including
  // NULL for a first checkpoint).
  undoCheckpoint: oc
    .route({
      method: 'POST',
      path: '/study-sessions/{sessionId}/checkpoints/{checkpointId}/undo',
      successStatus: 200,
    })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid(), checkpointId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          undone: z.boolean(),
          reverted: z.number().int(),
          skipped: z.number().int(),
        }),
      })
    ),

  // The backlog "I already know this" action from the claims sheet: seed the
  // selected never-practiced terms straight into review state (first
  // verification ~3 weeks out). Server-authoritative — only ids in the
  // checkpoint's stored backlog candidate set are accepted; anything else
  // (or a facet whose state changed since) counts into `skipped`.
  assertKnownBacklog: oc
    .route({
      method: 'POST',
      path: '/study-sessions/{sessionId}/checkpoints/{checkpointId}/assert-known',
      successStatus: 200,
    })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        checkpointId: z.string().uuid(),
        userLookupIds: z.array(z.string().uuid()).max(200),
      })
    )
    .output(z.object({ data: z.object({ asserted: z.number().int(), skipped: z.number().int() }) })),

  // Batch undo of a checkpoint's known-assertions. Independent of the
  // implicit-credit undo (the two lanes share checkpoint_id, discriminated by
  // was_explicit): no pointer change, no latest-checkpoint requirement.
  // Assertions superseded by a later rating are skipped.
  undoKnownAssertions: oc
    .route({
      method: 'POST',
      path: '/study-sessions/{sessionId}/checkpoints/{checkpointId}/undo-assertions',
      successStatus: 200,
    })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionId: z.string().uuid(), checkpointId: z.string().uuid() }))
    .output(z.object({ data: z.object({ reverted: z.number().int(), skipped: z.number().int() }) })),

  // Batched personalized-difficulty read for session cards + headers. POST
  // (not GET) because the sessions list is unpaginated and an id-array in the
  // URL risks length limits. Pinned semantics: ≤100 unique ids per call
  // (validated), the server dedupes and runs ONE auth-scoped session query;
  // missing/foreign/deleted ids are silently omitted from the result map;
  // sessions sharing a (track, language) cost one profile read. Per session:
  // `pending` while the profile build job runs (client refetches), `failed`
  // after terminal job failure (client stops polling and shows nothing),
  // `unsupported` for adhoc/lesson sessions and languages without a built
  // lemma-ranks asset. All lemma counts are DISTINCT representative lemmas
  // (one per all-candidates-unknown token group, highest-freq_mass candidate
  // as representative), never folded token types. `expectedCoveragePercent`
  // is floored so a shown "98%" never carries a sub-0.98 label; both it and
  // `label` are null for an empty (no matched tokens) profile.
  getDifficulties: oc
    .route({ method: 'POST', path: '/study-sessions/difficulties', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ sessionIds: z.array(z.string().uuid()).min(1).max(100) }))
    .output(
      z.object({
        data: z.object({
          difficulties: z.record(
            z.string().uuid(),
            z.object({
              status: z.enum(['available', 'pending', 'failed', 'unsupported']),
              expectedCoveragePercent: z.number().int().nullable(),
              label: z.enum(['comfortable', 'challenging', 'frustrating']).nullable(),
              unknownLemmaCount: z.number().int().nullable(),
              frequentUnknownCount: z.number().int().nullable(),
              savedNotStartedCount: z.number().int().nullable(),
              knownLemmaCount: z.number().int().nullable(),
            })
          ),
        }),
      })
    ),

  // Preview for the "mark the rest as known" sweep CTA: the EXACT number of
  // rows the sweep would insert (candidate lemmas minus studied
  // headword-lemmas minus already-known). `status` mirrors the difficulty
  // gate: 'unsupported' for synthetic (adhoc/lesson) sessions and languages
  // without wiktionary support, 'pending' while the track's lemma profile is
  // still building (the preview re-enqueues it; the client refetches).
  //
  // `toSegmentIndex` scopes the sweep to the segments [0, toSegmentIndex]
  // (clamped to the track's end) — the progressive multi-sitting flow: mark
  // what you've read so far, come back later, mark further. The span is
  // tokenized live through the checkpoint matcher (the stored profile carries
  // no segment positions), so a span preview is never 'pending'. Omitted →
  // the whole text via the profile.
  getMarkKnownPreview: oc
    .route({ method: 'GET', path: '/study-sessions/{sessionId}/mark-known-preview', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        toSegmentIndex: z.coerce.number().int().nonnegative().optional(),
      })
    )
    .output(
      z.object({
        data: z.object({
          status: z.enum(['ready', 'pending', 'unsupported']),
          markableLemmaCount: z.number().int(),
        }),
      })
    ),

  // The sweep itself: bulk-insert known_lemmas rows (source 'bulk_text',
  // source_id = this session; first-writer provenance). Ambiguous tokens mark
  // ALL their candidate lemmas; saved terms are always skipped (saving is the
  // stronger signal). UNPROCESSABLE_ENTITY carries 'UNSUPPORTED' (synthetic
  // session / unsupported language) or 'PROFILE_PENDING' (whole-text sweep
  // while the profile is still building — retry after the preview turns
  // ready). `toSegmentIndex` scopes to [0, toSegmentIndex] exactly like the
  // preview; repeated span sweeps accumulate (ON CONFLICT DO NOTHING + the
  // already-known exclusion make overlap free).
  markRemainingKnown: oc
    .route({ method: 'POST', path: '/study-sessions/{sessionId}/mark-known', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        sessionId: z.string().uuid(),
        toSegmentIndex: z.number().int().nonnegative().optional(),
      })
    )
    .output(z.object({ data: z.object({ markedCount: z.number().int() }) })),

  // Un-mark behind the gloss-sheet "Marked as known" chip: a bare DELETE of
  // the given lemmas (the `knownLemmaCandidates` the gloss returned — ALL
  // candidates the selected token represents, symmetric with the sweep
  // marking all of them). Zero side effects on SRS state.
  unmarkKnownLemma: oc
    .route({ method: 'POST', path: '/known-lemmas/unmark', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        targetLanguage: z.string().trim().min(1).max(40),
        lemmas: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
      })
    )
    .output(z.object({ data: z.object({ removedCount: z.number().int() }) })),

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

  // Session-vocabulary loaders: which highlights still have an enrich job in flight, and
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
          // a missing card in the session vocabulary list.
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
          // The server-detected subtitle language (also the session target
          // language) — the extension threads it into Intl.Segmenter so word
          // boundaries match the web reader's locale-aware tokenization.
          targetLanguage: z.string(),
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
          targetLanguage: z.string(),
          segments: z.array(TextSegmentSchema),
        }),
      })
    ),

  // Lookup-only counterpart to the two find-or-create video flows, used by the
  // extension to reload saved highlights when its session cache is cold (fresh
  // install, another device, cleared storage). NEVER creates rows: resolves the
  // documented identity chain — content_source by (user, type, metadata key:
  // youtubeVideoId for YouTube / contentHash for streaming) → text_track by
  // (content_source_id, hash) (hash only; the extension doesn't know the
  // detected language) → live study_session (user, track, deleted_at IS NULL) —
  // and returns the same response shape as find-or-create so the client needs
  // one branch. `data: null` = no session exists for this video (the normal
  // never-saved state, NOT an error/404).
  lookupForVideo: oc
    .route({ method: 'POST', path: '/study-sessions/lookup-for-video', successStatus: 200 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        source: z.enum(['youtube', 'streaming']),
        // Required when source='youtube' (validated server-side).
        youtubeVideoId: z.string().min(1).optional(),
        contentHash: z.string().min(1),
      })
    )
    .output(
      z.object({
        data: z
          .object({
            sessionId: z.string().uuid(),
            textTrackId: z.string().uuid(),
            contentSourceId: z.string().uuid(),
            targetLanguage: z.string(),
            segments: z.array(TextSegmentSchema),
          })
          .nullable(),
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
