import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import {
  ChunkRowSchema,
  ChunkSchema,
  FacetSkillSchema,
  FormFacetPayloadSchema,
  StudyFacetSummarySchema,
} from './common/flicktionary-schemas'

// Cursor wire format for `listChunks`. Encoded base64 over a JSON payload by
// both client and server; we keep the schema strict so a malformed cursor
// 400s cleanly instead of silently returning page 1.
export const ChunksSortSchema = z.enum(['recent', 'due'])
export type ChunksSort = z.infer<typeof ChunksSortSchema>

// Vocabulary list filters (Sort & filter control). `skills` is a multi-select
// over study-skill membership (OR within the set: a term matches if it has an
// enabled facet of ANY listed skill, on the citation OR any form). `status` is
// a single study-state bucket on the term's citation recognition facet, and
// `hasMultipleForms` keeps only terms studied in at least one inflected form.
export const VOCAB_FILTER_SKILLS = ['recognition', 'production', 'pronunciation'] as const
export const VocabFilterSkillSchema = z.enum(VOCAB_FILTER_SKILLS)
export type VocabFilterSkill = z.infer<typeof VocabFilterSkillSchema>

// SRS stages of the citation recognition facet. The six stages are DISJOINT
// and partition a language's kept terms exactly (the practice landing's
// segmented bar depends on that): up_next = eligible to be introduced (the
// stage IS the introduction queue, so it forces queue ordering server-side),
// warming_up = parked before first review, learning = in short-term learning
// states, review = graduated, strengthen = leech-parked, unseen = everything
// never studied and not currently introducible (missing/disabled facet, or
// decayed out of freshness).
export const VOCAB_STAGES = ['up_next', 'warming_up', 'learning', 'review', 'strengthen', 'unseen'] as const
export const VocabStageSchema = z.enum(VOCAB_STAGES)
export type VocabStage = z.infer<typeof VocabStageSchema>

export const VocabStatusSchema = z.enum(['due', ...VOCAB_STAGES])
export type VocabStatus = z.infer<typeof VocabStatusSchema>

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
  // status='up_next' pages in introduction order (newTermOrderSql): tier, zipf
  // DESC, created_at, headword, sense, id. All keys ride the cursor so one row
  // comparison resumes the scan; zipfKey carries COALESCE(zipf_estimate, -1).
  z.object({
    sort: z.literal('queue'),
    tier: z.number().int(),
    zipfKey: z.number(),
    createdAt: z.string(),
    headword: z.string(),
    sense: z.string(),
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
        // Optional accent- and case-insensitive substring filter applied
        // across headword, translation, and definition, with trigram typo
        // tolerance (pg_trgm word_similarity) on the same fields. Empty
        // string is treated as no filter.
        q: z.string().optional(),
        // Skill-membership filter, a comma-separated list of VOCAB_FILTER_SKILLS
        // tokens (e.g. "production,pronunciation"). OR within the set. Sent as a
        // CSV string rather than z.array to dodge array-over-GET query
        // serialization; the server splits + validates, ignoring unknown tokens.
        skills: z.string().optional(),
        // Study-state bucket on the citation recognition facet: 'due' = a review
        // is waiting now; the six VOCAB_STAGES partition the kept terms (see
        // VocabStageSchema). 'up_next' additionally forces introduction-queue
        // ordering server-side — `sort` is ignored for it. Omitted = no filter.
        status: VocabStatusSchema.optional(),
        // Keep only terms studied in at least one inflected form (an enabled
        // facet with a non-empty target_form). GET delivers the boolean as a
        // string, so accept either (z.stringbool() parses 'true'/'false').
        hasMultipleForms: z.union([z.boolean(), z.stringbool()]).optional(),
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
  // facet IS production-study membership (enabled => in production study), and
  // meaning_recognition is enabled on keep. enabled:true upserts
  // the facet — creating it (NULL srs state) if absent, else CLEARING its
  // disabled_at so a previously-disabled, history-bearing facet resumes its
  // schedule. enabled:false sets disabled_at (disable != delete: SRS history is
  // kept). `payload` carries {form, translation} for form facets (Phase 4).
  // `targetForm` defaults to '' (the citation/lemma).
  setFacetEnabled: oc
    .route({ method: 'PATCH', path: '/chunks/{chunkId}/facets/enabled', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      // Disabling the last enabled facet of a KEPT term would leave it studied
      // for nothing — the floor guard rejects it (delete the term instead).
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
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
  // DTO only derives `isProductionEnabled` from the citation production facet;
  // the term view needs every facet's identity + enabled + data readiness to render
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

  // Manual counterpart to generateFacetData and the edit path for an existing
  // form facet: the user types the form's full card content themselves
  // (translation / definition / examples / grammar subset, not just a gloss). The
  // payload is shallow-merged into the facet's JSONB and data_status flips to
  // ready. Returns the refreshed study-targets. `payload` is the full
  // FormFacetPayloadSchema — partial keys are fine (the merge preserves
  // untouched ones), but `grammar` must always be sent COMPLETE because the
  // shallow `payload || $new` merge replaces the whole `grammar` sub-object
  // (it does not deep-merge it).
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
        payload: FormFacetPayloadSchema,
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

  // Hard-delete one study facet (skill x target_form) of a term — the explicit
  // "Remove form" action on a form chip. Unlike setFacetEnabled (disable !=
  // delete: keeps SRS history for re-enable), this drops the facet and its
  // schedule entirely, and is irreversible short of re-adding the form. Returns
  // the refreshed study-targets so the removed chip disappears without a second
  // round-trip. `targetForm` is normalized server-side. (Citation removal is
  // expressed as Delete term — deleteChunk — not this.)
  deleteFacet: oc
    .route({ method: 'POST', path: '/chunks/{chunkId}/facets/delete', successStatus: 200 })
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
