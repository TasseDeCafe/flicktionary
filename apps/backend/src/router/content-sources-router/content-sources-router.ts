import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { contentSourcesContract } from '@flicktionary/api-client/orpc-contracts/content-sources-contract'
import {
  ContentSourcesRepositoryInterface,
  DbContentSource,
} from '../../transport/database/content-sources/content-sources-repository'
import { searchMovies } from '../../transport/third-party/tmdb/tmdb-client'

const toContentSourceDto = (row: DbContentSource) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  language: row.language,
  metadata: (row.metadata ?? {}) as Record<string, unknown>,
  createdByUserId: row.created_by_user_id,
  createdAt: new Date(row.created_at).toISOString(),
})

export const ContentSourcesRouter = (contentSourcesRepository: ContentSourcesRepositoryInterface): Router => {
  const implementer = implement(contentSourcesContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    searchTmdb: implementer.searchTmdb.handler(async ({ input }) => {
      const movies = await searchMovies(input.query, input.year)
      return { data: movies }
    }),

    createFromTmdb: implementer.createFromTmdb.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const existing = await contentSourcesRepository.findByTmdbId(input.tmdbId)
      if (existing) {
        return { data: toContentSourceDto(existing) }
      }
      const inserted = await contentSourcesRepository.insertContentSource({
        type: 'movie',
        title: input.title,
        language: input.language,
        metadata: {
          tmdbId: input.tmdbId,
          originalTitle: input.originalTitle,
          year: input.year,
          posterUrl: input.posterUrl,
        },
        createdByUserId: userId,
      })
      return { data: toContentSourceDto(inserted) }
    }),

    createText: implementer.createText.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const inserted = await contentSourcesRepository.insertContentSource({
        type: 'text',
        title: input.title,
        language: input.language,
        metadata: {},
        createdByUserId: userId,
      })
      return { data: toContentSourceDto(inserted) }
    }),
  })

  return createOrpcExpressRouter(router, { contract: contentSourcesContract })
}
