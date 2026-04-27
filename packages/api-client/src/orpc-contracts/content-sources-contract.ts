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

export const contentSourcesContract = {
  searchTmdb: oc
    .route({ method: 'GET', path: '/content-sources/tmdb/search', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
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
} as const
