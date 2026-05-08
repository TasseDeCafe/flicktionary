import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { ChunkRowSchema, ChunkSchema } from './common/flicktionary-schemas'

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
      })
    )
    .output(
      z.object({
        rows: z.array(ChunkRowSchema),
        nextCursor: z.string().nullable(),
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

  // Cross-session CSV export. Returns one row per kept chunk in the given
  // target language with the same column shape per-session export uses, so
  // both flow into Anki identically. Surface form / context fall back to
  // empty when the originating card or segment has been removed.
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
} as const
