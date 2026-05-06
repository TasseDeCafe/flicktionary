import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { ChunkSchema } from './common/flicktionary-schemas'

// Mutations on the canonical vocabulary entries (user_lookups). Edits made
// here propagate to every card that references the chunk, so the focus view
// can show consistent content across sessions.
export const chunksContract = {
  // Patch any subset of the gloss/example fields. `undefined` (omitted)
  // preserves the existing value; `null` clears it. `explorationExtrasPatch`
  // is shallow-merged into exploration_extras via JSONB `||` on the server.
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
} as const
