import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { contentSourcesContract } from '@flicktionary/api-client/orpc-contracts/content-sources-contract'
import {
  ContentSourcesRepositoryInterface,
  DbContentSource,
} from '../../transport/database/content-sources/content-sources-repository'
import { searchMovies } from '../../transport/third-party/tmdb/tmdb-client'
import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'

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
  const implementer = implement(contentSourcesContract).$context<OrpcContext>()

  const router = implementer.router({
    searchTmdb: implementer.searchTmdb.handler(async ({ input, errors }) => {
      try {
        const movies = await searchMovies(input.query, input.year)
        return { data: movies }
      } catch (e) {
        logCustomErrorMessageAndError(`contentSources.searchTmdb, query = ${input.query}`, e)
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'TMDB search failed' }] },
        })
      }
    }),

    createFromTmdb: implementer.createFromTmdb.handler(async ({ input, context, errors }) => {
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
      if (!inserted) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to create content source' }] },
        })
      }
      return { data: toContentSourceDto(inserted) }
    }),
  })

  return createOrpcExpressRouter(router, { contract: contentSourcesContract })
}
