import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { ContentSourceSchema } from './common/flicktionary-schemas'

const TmdbMovieSchema = z.object({
  tmdbId: z.number().int(),
  title: z.string(),
  originalTitle: z.string(),
  year: z.number().int().nullable(),
  posterUrl: z.string().nullable(),
  overview: z.string(),
})

const TmdbTvShowSchema = z.object({
  tmdbId: z.number().int(),
  title: z.string(),
  originalTitle: z.string(),
  year: z.number().int().nullable(),
  posterUrl: z.string().nullable(),
  overview: z.string(),
})

const TmdbSeasonSchema = z.object({
  seasonNumber: z.number().int(),
  name: z.string(),
  episodeCount: z.number().int(),
  posterUrl: z.string().nullable(),
})

const TmdbEpisodeSchema = z.object({
  episodeNumber: z.number().int(),
  name: z.string(),
  overview: z.string(),
  stillUrl: z.string().nullable(),
})

// The procedures that call TMDB live (the searches and season/episode lookups;
// createFromTmdb* are DB-only) answer TOO_MANY_REQUESTS with code
// 'UPSTREAM_RATE_LIMITED' when TMDB throttles the server's IP — transient,
// retrying shortly works.
export const contentSourcesContract = {
  searchTmdb: oc
    .route({ method: 'GET', path: '/content-sources/tmdb/search', successStatus: 200 })
    .errors({
      TOO_MANY_REQUESTS: { status: 429, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ query: z.string().min(1), year: z.coerce.number().int().optional() }))
    .output(z.object({ data: z.array(TmdbMovieSchema) })),

  createFromTmdb: oc
    .route({ method: 'POST', path: '/content-sources/tmdb', successStatus: 201 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(
      z.object({
        tmdbId: z.number().int(),
        title: z.string(),
        originalTitle: z.string(),
        year: z.number().int().nullable(),
        posterUrl: z.string().nullable(),
        language: z.string(),
      })
    )
    .output(z.object({ data: ContentSourceSchema })),

  searchTmdbTv: oc
    .route({ method: 'GET', path: '/content-sources/tmdb/tv/search', successStatus: 200 })
    .errors({
      TOO_MANY_REQUESTS: { status: 429, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ query: z.string().min(1) }))
    .output(z.object({ data: z.array(TmdbTvShowSchema) })),

  tmdbTvSeasons: oc
    .route({ method: 'GET', path: '/content-sources/tmdb/tv/seasons', successStatus: 200 })
    .errors({
      TOO_MANY_REQUESTS: { status: 429, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ tmdbId: z.coerce.number().int() }))
    .output(z.object({ data: z.array(TmdbSeasonSchema) })),

  tmdbTvEpisodes: oc
    .route({ method: 'GET', path: '/content-sources/tmdb/tv/episodes', successStatus: 200 })
    .errors({
      TOO_MANY_REQUESTS: { status: 429, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ tmdbId: z.coerce.number().int(), seasonNumber: z.coerce.number().int() }))
    .output(z.object({ data: z.array(TmdbEpisodeSchema) })),

  createFromTmdbTv: oc
    .route({ method: 'POST', path: '/content-sources/tmdb/tv', successStatus: 201 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(
      z.object({
        tmdbShowId: z.number().int(),
        showTitle: z.string(),
        originalTitle: z.string(),
        seasonNumber: z.number().int(),
        episodeNumber: z.number().int(),
        episodeTitle: z.string(),
        year: z.number().int().nullable(),
        posterUrl: z.string().nullable(),
        language: z.string(),
      })
    )
    .output(z.object({ data: ContentSourceSchema })),

  createText: oc
    .route({ method: 'POST', path: '/content-sources/text', successStatus: 201 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(
      z.object({
        title: z.string().min(1).max(200),
        language: z.string().min(2).max(10),
      })
    )
    .output(z.object({ data: ContentSourceSchema })),
} as const
