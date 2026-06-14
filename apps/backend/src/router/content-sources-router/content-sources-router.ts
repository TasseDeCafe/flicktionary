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
import { searchMovies, searchTvShows, getTvSeasons, getTvEpisodes } from '../../transport/third-party/tmdb/tmdb-client'

const pad2 = (n: number): string => String(n).padStart(2, '0')

const tvEpisodeTitle = (
  showTitle: string,
  seasonNumber: number,
  episodeNumber: number,
  episodeTitle: string
): string => {
  const code = `S${pad2(seasonNumber)}E${pad2(episodeNumber)}`
  return episodeTitle ? `${showTitle} · ${code} · ${episodeTitle}` : `${showTitle} · ${code}`
}

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

    searchTmdbTv: implementer.searchTmdbTv.handler(async ({ input }) => {
      const shows = await searchTvShows(input.query)
      return { data: shows }
    }),

    tmdbTvSeasons: implementer.tmdbTvSeasons.handler(async ({ input }) => {
      const seasons = await getTvSeasons(input.tmdbId)
      return { data: seasons }
    }),

    tmdbTvEpisodes: implementer.tmdbTvEpisodes.handler(async ({ input }) => {
      const episodes = await getTvEpisodes(input.tmdbId, input.seasonNumber)
      return { data: episodes }
    }),

    createFromTmdbTv: implementer.createFromTmdbTv.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const contentSource = await contentSourcesRepository.getOrCreateTvEpisode({
        title: tvEpisodeTitle(input.showTitle, input.seasonNumber, input.episodeNumber, input.episodeTitle),
        language: input.language,
        metadata: {
          tmdbShowId: input.tmdbShowId,
          showTitle: input.showTitle,
          originalTitle: input.originalTitle,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
          episodeTitle: input.episodeTitle,
          year: input.year,
          posterUrl: input.posterUrl,
        },
        createdByUserId: userId,
      })
      return { data: toContentSourceDto(contentSource) }
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
