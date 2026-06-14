import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { textTracksContract } from '@flicktionary/api-client/orpc-contracts/text-tracks-contract'
import { searchByTmdbId, searchEpisodeSubtitles } from '../../transport/third-party/opensubtitles/opensubtitles-client'
import { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import { TextTracksRepositoryInterface, DbTextTrack } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { importSrt } from '../../service/text-tracks/import-srt'
import { importFromOpenSubtitles } from '../../service/text-tracks/import-from-opensubtitles'
import { importPastedText } from '../../service/text-tracks/import-pasted-text'

const toTextTrackDto = (row: DbTextTrack) => ({
  id: row.id,
  contentSourceId: row.content_source_id,
  source: row.source,
  language: row.language,
  externalId: row.external_id,
  hash: row.hash,
  createdAt: new Date(row.created_at).toISOString(),
})

export type TextTracksRouterDependencies = {
  contentSourcesRepository: ContentSourcesRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
}

export const TextTracksRouter = (deps: TextTracksRouterDependencies): Router => {
  const implementer = implement(textTracksContract).$context<OrpcContext>().use(errorBoundaryMiddleware)
  const { contentSourcesRepository, textTracksRepository, textSegmentsRepository } = deps

  const router = implementer.router({
    searchOpenSubtitles: implementer.searchOpenSubtitles.handler(async ({ input }) => {
      const tracks = await searchByTmdbId(input.tmdbId, input.language)
      return { data: tracks }
    }),

    searchOpenSubtitlesEpisode: implementer.searchOpenSubtitlesEpisode.handler(async ({ input }) => {
      const tracks = await searchEpisodeSubtitles(input)
      return { data: tracks }
    }),

    importFromOpenSubtitles: implementer.importFromOpenSubtitles.handler(async ({ input, errors }) => {
      const contentSource = await contentSourcesRepository.findById(input.contentSourceId)
      if (!contentSource) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Content source not found' }] },
        })
      }
      const result = await importFromOpenSubtitles(input, textTracksRepository, textSegmentsRepository)
      if (!result.ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Subtitle file did not contain any usable cues' }] },
        })
      }
      return { data: { track: toTextTrackDto(result.track), segmentCount: result.segmentCount } }
    }),

    uploadSrt: implementer.uploadSrt.handler(async ({ input, errors }) => {
      const contentSource = await contentSourcesRepository.findById(input.contentSourceId)
      if (!contentSource) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'Content source not found' }] },
        })
      }
      const result = await importSrt(
        {
          contentSourceId: input.contentSourceId,
          source: 'upload',
          language: input.language,
          externalId: null,
          srtContent: input.srtContent,
        },
        textTracksRepository,
        textSegmentsRepository
      )
      if (!result.ok) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'Subtitle file did not contain any usable cues' }] },
        })
      }
      return { data: { track: toTextTrackDto(result.track), segmentCount: result.segmentCount } }
    }),

    importFromPaste: implementer.importFromPaste.handler(async ({ input, errors }) => {
      const contentSource = await contentSourcesRepository.findById(input.contentSourceId)
      if (!contentSource) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'Content source not found' }] },
        })
      }
      const result = await importPastedText(input, textTracksRepository, textSegmentsRepository)
      if (!result.ok) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'Pasted text did not contain any usable lines' }] },
        })
      }
      return { data: { track: toTextTrackDto(result.track), segmentCount: result.segmentCount } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: textTracksContract })
}
