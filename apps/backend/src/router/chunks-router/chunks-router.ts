import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import {
  chunksContract,
  ChunksCursorSchema,
  type ChunksCursor,
} from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import {
  ChunkRow,
  DbUserLookup,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import { buildVocabularyCsv } from '../../service/export/build-vocabulary-csv'
import { toIsoString } from '../router-utils'

const toChunkDto = (row: DbUserLookup) => ({
  id: row.id,
  userId: row.user_id,
  targetLanguage: row.target_language,
  headword: row.headword,
  sense: row.sense ?? '',
  translation: row.translation,
  definition: row.definition,
  targetExample: row.target_example,
  nativeExample: row.native_example,
  explorationExtras: (row.exploration_extras ?? {}) as Record<string, unknown>,
  grammar: (row.grammar ?? {}) as Record<string, unknown>,
  groundedAt: toIsoString(row.grounded_at),
  grammarUserEditedAt: toIsoString(row.grammar_user_edited_at),
})

const toChunkRowDto = (row: ChunkRow) => ({
  id: row.id,
  userId: row.userId,
  targetLanguage: row.targetLanguage,
  headword: row.headword,
  sense: row.sense,
  translation: row.translation,
  definition: row.definition,
  targetExample: row.targetExample,
  nativeExample: row.nativeExample,
  explorationExtras: row.explorationExtras,
  grammar: row.grammar,
  groundedAt: toIsoString(row.groundedAt),
  grammarUserEditedAt: toIsoString(row.grammarUserEditedAt),
  count: row.count,
  srsState: row.srsState,
  srsDue: toIsoString(row.srsDue),
  srsReps: row.srsReps,
  createdAt: toIsoString(row.createdAt) ?? new Date(0).toISOString(),
  firstCardId: row.firstCardId,
  firstCardSegmentId: row.firstCardSegmentId,
  studySessionId: row.studySessionId,
  sourceAvailable: row.sourceAvailable,
})

// Opaque base64-of-JSON wire format for the listChunks cursor. Returning null
// from decode means "ignore the cursor and start from page 1" — the
// frontend should only ever feed us cursors we just emitted, so we treat a
// malformed cursor as "fall back to page 1" rather than 400ing.
const decodeCursor = (raw: string | null | undefined): ChunksCursor | null => {
  if (!raw) return null
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8')
    const parsed = ChunksCursorSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const encodeCursor = (cursor: ChunksCursor | null): string | null => {
  if (!cursor) return null
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64')
}

const hasGrammarPatch = (patch: Record<string, unknown> | null | undefined): boolean =>
  !!patch && Object.keys(patch).length > 0

export const ChunksRouter = (userLookupsRepository: UserLookupsRepositoryInterface): Router => {
  const implementer = implement(chunksContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    updateContent: implementer.updateContent.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      await userLookupsRepository.updateContent({
        id: input.chunkId,
        translation: input.patch.translation,
        definition: input.patch.definition,
        targetExample: input.patch.targetExample,
        nativeExample: input.patch.nativeExample,
        explorationExtrasPatch: input.patch.explorationExtrasPatch ?? null,
        grammarPatch: input.patch.grammarPatch ?? null,
        markGrammarUserEdited: hasGrammarPatch(input.patch.grammarPatch),
      })
      const refreshed = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!refreshed) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk disappeared after update' }] } })
      }
      return { data: toChunkDto(refreshed) }
    }),

    listChunks: implementer.listChunks.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const trimmedQ = input.q?.trim() ?? ''
      const { rows, nextCursor } = await userLookupsRepository.listChunksForLanguage({
        userId,
        targetLanguage: input.targetLanguage,
        sort: input.sort,
        cursor: decodeCursor(input.cursor),
        limit: input.limit,
        q: trimmedQ.length > 0 ? trimmedQ : null,
      })
      return { rows: rows.map(toChunkRowDto), nextCursor: encodeCursor(nextCursor) }
    }),

    listLanguages: implementer.listLanguages.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const languages = await userLookupsRepository.listLanguagesForUser(userId)
      return { languages }
    }),

    exportCsv: implementer.exportCsv.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const result = await buildVocabularyCsv(userId, input.targetLanguage, { userLookupsRepository })
      return { data: { csv: result.csv, chunkCount: result.chunkCount } }
    }),

    deleteChunk: implementer.deleteChunk.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.id, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      await userLookupsRepository.softDeleteChunk(input.id, userId)
      return { data: { id: input.id } }
    }),

    restoreChunk: implementer.restoreChunk.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      // Restore targets soft-deleted rows by definition, so the deleted-filter
      // in findByIdForUser would 404 a valid restore. Use the including-
      // deleted variant for the ownership check.
      const owned = await userLookupsRepository.findByIdForUserIncludingDeleted(input.id, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      await userLookupsRepository.restoreChunk(input.id, userId)
      return { data: { id: input.id } }
    }),

    rename: implementer.rename.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      const result = await userLookupsRepository.renameKey({
        id: input.chunkId,
        headword: input.headword,
        sense: input.sense,
        markGrammarUserEdited: true,
      })
      if (!result.ok) {
        throw errors.CONFLICT({
          data: { errors: [{ message: 'Another chunk already exists with that headword and sense' }] },
        })
      }
      const refreshed = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!refreshed) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk disappeared after rename' }] } })
      }
      return { data: toChunkDto(refreshed) }
    }),
  })

  return createOrpcExpressRouter(router, { contract: chunksContract })
}
