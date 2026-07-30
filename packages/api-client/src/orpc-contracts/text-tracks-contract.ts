import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { TextTrackSchema } from './common/flicktionary-schemas'

const OpenSubtitlesTrackSchema = z.object({
  fileId: z.number().int(),
  language: z.string(),
  release: z.string(),
  fps: z.number().nullable(),
  hearingImpaired: z.boolean(),
  uploaderName: z.string().nullable(),
  downloadCount: z.number().int(),
})

const TrackImportResponseSchema = z.object({
  data: z.object({
    track: TextTrackSchema,
    segmentCount: z.number().int(),
  }),
})

// The OpenSubtitles procedures answer TOO_MANY_REQUESTS with code
// 'UPSTREAM_RATE_LIMITED' (transient request-rate throttling — retry shortly)
// or, on import only, 'UPSTREAM_QUOTA_EXCEEDED' (the shared daily download
// quota is spent — retrying won't help until it resets).
export const textTracksContract = {
  searchOpenSubtitles: oc
    .route({ method: 'GET', path: '/text-tracks/opensubtitles/search', successStatus: 200 })
    .errors({
      TOO_MANY_REQUESTS: { status: 429, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ tmdbId: z.coerce.number().int(), language: z.string() }))
    .output(z.object({ data: z.array(OpenSubtitlesTrackSchema) })),

  searchOpenSubtitlesEpisode: oc
    .route({ method: 'GET', path: '/text-tracks/opensubtitles/episode/search', successStatus: 200 })
    .errors({
      TOO_MANY_REQUESTS: { status: 429, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        tmdbShowId: z.coerce.number().int(),
        seasonNumber: z.coerce.number().int(),
        episodeNumber: z.coerce.number().int(),
        language: z.string(),
      })
    )
    .output(z.object({ data: z.array(OpenSubtitlesTrackSchema) })),

  importFromOpenSubtitles: oc
    .route({ method: 'POST', path: '/text-tracks/opensubtitles/import', successStatus: 201 })
    .errors({
      TOO_MANY_REQUESTS: { status: 429, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        contentSourceId: z.string().uuid(),
        fileId: z.number().int(),
        language: z.string(),
      })
    )
    .output(TrackImportResponseSchema),

  uploadSrt: oc
    .route({ method: 'POST', path: '/text-tracks/upload', successStatus: 201 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        contentSourceId: z.string().uuid(),
        language: z.string(),
        srtContent: z.string().min(1),
      })
    )
    .output(TrackImportResponseSchema),

  importFromPaste: oc
    .route({ method: 'POST', path: '/text-tracks/paste', successStatus: 201 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        contentSourceId: z.string().uuid(),
        language: z.string(),
        text: z.string().min(50).max(20_000),
      })
    )
    .output(TrackImportResponseSchema),
} as const
