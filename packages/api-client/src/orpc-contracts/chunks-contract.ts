import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import {
  ChunkRowSchema,
  ChunkSchema,
  FacetSkillSchema,
  LearningModeSchema,
  StudyFacetSummarySchema,
} from './common/flicktionary-schemas'

// Cursor wire format for `listChunks`. Encoded base64 over a JSON payload by
// both client and server; we keep the schema strict so a malformed cursor
// 400s cleanly instead of silently returning page 1.
export const ChunksSortSchema = z.enum(['recent', 'due'])
export type ChunksSort = z.infer<typeof ChunksSortSchema>

export const ChunksCursorSchema = z.union([
  z.object({
    sort: z.literal('recent'),
    createdAt: z.string(),
    id: z.string().uuid(),
  }),
  z.object({
    sort: z.literal('due'),
    phase: z.literal('scheduled'),
    srsDue: z.string(),
    id: z.string().uuid(),
  }),
  z.object({
    sort: z.literal('due'),
    phase: z.literal('unscheduled'),
    id: z.string().uuid(),
  }),
])
export type ChunksCursor = z.infer<typeof ChunksCursorSchema>

// Mutations on the canonical vocabulary entries (user_lookups). Edits made
// here propagate to every card that references the chunk, so the focus view
// can show consistent content across sessions.
export const chunksContract = {
  // Fetch one chunk in full (the flashcard actions menu opens on a lean
  // ReviewTerm and needs learningMode/etc. on demand). `firstCardId` /
  // `firstCardSessionId` are the representative-card deep-link pointer
  // (resolved via the first_card_id back-pointer, same join as the vocabulary
  // list) so "Edit term" can open the focus view at
  // `/sessions/$sessionId/review/$cardId`. Kept out of ChunkSchema — that
  // shape is reused by listChunks/updateContent, which don't pay for the join.
  get: oc
    .route({ method: 'GET', path: '/chunks/{chunkId}', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ chunkId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          chunk: ChunkSchema,
          firstCardId: z.string().uuid().nullable(),
          firstCardSessionId: z.string().uuid().nullable(),
        }),
      })
    ),

  // Patch any subset of the gloss/example fields. `undefined` (omitted)
  // preserves the existing value; `null` clears it. `explorationExtrasPatch`
  // and `grammarPatch` are shallow-merged into their JSONB columns via `||`
  // on the server (set a key to JSON null to "clear" it visually — the
  // renderer hides nulls).
  updateContent: oc
    .route({ method: 'PATCH', path: '/chunks/{chunkId}/content', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        chunkId: z.string().uuid(),
        patch: z.object({
          translation: z.string().nullable().optional(),
          definition: z.string().nullable().optional(),
          targetExample: z.string().nullable().optional(),
          nativeExample: z.string().nullable().optional(),
          explorationExtrasPatch: z.record(z.string(), z.unknown()).nullable().optional(),
          grammarPatch: z.record(z.string(), z.unknown()).nullable().optional(),
        }),
      })
    )
    .output(z.object({ data: ChunkSchema })),

  // Renames the (headword, sense) pair on the canonical row. Returns 409
  // CONFLICT when the target pair already exists for another chunk in the same
  // (user, target_language). No silent merge in v1.
  rename: oc
    .route({ method: 'PATCH', path: '/chunks/{chunkId}/rename', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        chunkId: z.string().uuid(),
        headword: z.string().min(1),
        sense: z.string().default(''),
      })
    )
    .output(z.object({ data: ChunkSchema })),

  // Vocabulary management list. Returns kept chunks for one target language
  // with cursor pagination. `cursor` is base64(JSON of ChunksCursor); the
  // server decodes/encodes — frontend just round-trips the opaque string.
  listChunks: oc
    .route({ method: 'GET', path: '/chunks', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        targetLanguage: z.string().min(1),
        sort: ChunksSortSchema.default('recent'),
        cursor: z.string().nullable().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        // Optional case-insensitive substring filter applied across headword,
        // translation, and definition. Empty string is treated as no filter.
        q: z.string().optional(),
        // Optional learning_mode filter. Omitted/null means "All"; otherwise
        // restrict to passive or active terms.
        learningMode: LearningModeSchema.nullable().optional(),
      })
    )
    .output(
      z.object({
        rows: z.array(ChunkRowSchema),
        nextCursor: z.string().nullable(),
      })
    ),

  // Enable or disable a single study facet (skill x target_form) on a term.
  // This is the unified study-target control: the citation meaning_production
  // facet is what "active vocabulary" used to mean (enabled => in production
  // study), and meaning_recognition is enabled on keep. enabled:true upserts
  // the facet — creating it (NULL srs state) if absent, else CLEARING its
  // disabled_at so a previously-disabled, history-bearing facet resumes its
  // schedule. enabled:false sets disabled_at (disable != delete: SRS history is
  // kept). `payload` carries {form, translation} for form facets (Phase 4).
  // `targetForm` defaults to '' (the citation/lemma).
  setFacetEnabled: oc
    .route({ method: 'PATCH', path: '/chunks/{chunkId}/facets/enabled', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        chunkId: z.string().uuid(),
        skill: FacetSkillSchema,
        targetForm: z.string().default(''),
        enabled: z.boolean(),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(z.object({ data: ChunkSchema })),

  // Read the study facets of one term for the Study-targets control. The chunk
  // DTO only derives `learningMode` from the citation production facet; the
  // term view needs every facet's identity + enabled + data readiness to render
  // the pronunciation row (Phase 4a) and form chips (Phase 4b). Fetched lazily
  // when the term view opens (kept off the chunk DTO so the vocab list payload
  // stays lean — most chunks never open the term view). Phase 4b extends the
  // output with `candidateForms` (encountered surface forms for "+ Add a form").
  getStudyTargets: oc
    .route({ method: 'GET', path: '/chunks/{chunkId}/study-targets', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ chunkId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          facets: z.array(StudyFacetSummarySchema),
          // Encountered surface forms (distinct kept-card forms, minus the lemma
          // and any already-faceted form) for the "+ Add a form" picker. The
          // string is all a card row stores; data is generated on enable.
          candidateForms: z.array(z.string()),
        }),
      })
    ),

  // Generate-and-confirm: fill a pending_data form facet's payload via an Opus
  // pass (the form's spelling + a translation of that exact inflection) and flip
  // it to ready so the queue serves it. Synchronous (user waits behind a
  // spinner). Returns the refreshed study-targets so the chip reflects the new
  // ready state without a second round-trip. `targetForm` is normalized
  // server-side (normalizeTargetForm) before it keys the facet.
  generateFacetData: oc
    .route({ method: 'POST', path: '/chunks/{chunkId}/facets/generate', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        chunkId: z.string().uuid(),
        skill: FacetSkillSchema,
        targetForm: z.string().min(1),
      })
    )
    .output(
      z.object({
        data: z.object({
          facets: z.array(StudyFacetSummarySchema),
          candidateForms: z.array(z.string()),
        }),
      })
    ),

  // Manual counterpart to generateFacetData: the user types the form's data
  // themselves (the "enter it yourself" escape from a pending_data facet, and
  // the edit path for an existing one). Merges {form, translation} into the
  // payload and flips data_status to ready. Returns the refreshed study-targets.
  setFacetPayload: oc
    .route({ method: 'PATCH', path: '/chunks/{chunkId}/facets/payload', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        chunkId: z.string().uuid(),
        skill: FacetSkillSchema,
        targetForm: z.string().min(1),
        payload: z.object({
          form: z.string(),
          translation: z.string().nullable().optional(),
        }),
      })
    )
    .output(
      z.object({
        data: z.object({
          facets: z.array(StudyFacetSummarySchema),
          candidateForms: z.array(z.string()),
        }),
      })
    ),

  // Distinct target_languages the user has at least one (non-deleted) chunk in.
  // Powers the language switcher pills on the Vocabulary tab.
  listLanguages: oc
    .route({ method: 'GET', path: '/chunks/languages', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({}))
    .output(z.object({ languages: z.array(z.string()) })),

  // Cross-session CSV export (Anki feed). Returns one row per kept chunk in
  // the given target language, opening with Anki # directives and one column
  // per basic/grammar/extras datum (see SPEC "Export"). Surface form /
  // context fall back to empty when the originating card or segment has been
  // removed.
  exportCsv: oc
    .route({ method: 'POST', path: '/chunks/export', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ targetLanguage: z.string().min(1) }))
    .output(
      z.object({
        data: z.object({
          csv: z.string(),
          chunkCount: z.number().int(),
        }),
      })
    ),

  // Soft-delete a chunk. POST (not DELETE) for symmetry with other mutations
  // and to avoid URL-encoding the UUID. Hides the chunk from the Vocabulary
  // list AND from the Practice queue. Re-keeping the same headword later
  // revives the row.
  deleteChunk: oc
    .route({ method: 'POST', path: '/chunks/delete', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ data: z.object({ id: z.string().uuid() }) })),

  // Explicit restore counterpart to deleteChunk. Clears `deleted_at` without
  // touching count / status / SRS state — the row resumes participating in
  // Vocabulary + Practice with its existing schedule. Used by the practice
  // text's Restore action (the keep-transition revival path still works for
  // re-key flows; this is just the no-status-change equivalent).
  restoreChunk: oc
    .route({ method: 'POST', path: '/chunks/restore', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ data: z.object({ id: z.string().uuid() }) })),
} as const
