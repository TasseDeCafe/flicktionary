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

export const textTracksContract = {
  searchOpenSubtitles: oc
    .route({ method: 'GET', path: '/text-tracks/opensubtitles/search', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ tmdbId: z.coerce.number().int(), language: z.string() }))
    .output(z.object({ data: z.array(OpenSubtitlesTrackSchema) })),

  importFromOpenSubtitles: oc
    .route({ method: 'POST', path: '/text-tracks/opensubtitles/import', successStatus: 201 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
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
