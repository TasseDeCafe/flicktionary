import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { chunksContract } from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import { DbUserLookup, UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'

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
})

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
      })
      const refreshed = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!refreshed) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk disappeared after update' }] } })
      }
      return { data: toChunkDto(refreshed) }
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
