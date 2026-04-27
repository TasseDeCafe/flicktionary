import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { textTracksContract } from '@flicktionary/api-client/orpc-contracts/text-tracks-contract'
import { searchByTmdbId } from '../../transport/third-party/opensubtitles/opensubtitles-client'
import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import { TextTracksRepositoryInterface, DbTextTrack } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { importSrt } from '../../service/text-tracks/import-srt'
import { importFromOpenSubtitles } from '../../service/text-tracks/import-from-opensubtitles'

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
  const implementer = implement(textTracksContract).$context<OrpcContext>()
  const { contentSourcesRepository, textTracksRepository, textSegmentsRepository } = deps

  const router = implementer.router({
    searchOpenSubtitles: implementer.searchOpenSubtitles.handler(async ({ input, errors }) => {
      try {
        const tracks = await searchByTmdbId(input.tmdbId, input.language)
        return { data: tracks }
      } catch (e) {
        logCustomErrorMessageAndError(
          `textTracks.searchOpenSubtitles, tmdbId = ${input.tmdbId}, language = ${input.language}`,
          e
        )
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'OpenSubtitles search failed' }] },
        })
      }
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
          data: {
            errors: [
              {
                message:
                  result.reason === 'parse_empty'
                    ? 'Subtitle file did not contain any usable cues'
                    : 'Failed to persist subtitle track',
              },
            ],
          },
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
        if (result.reason === 'parse_empty') {
          throw errors.BAD_REQUEST({
            data: { errors: [{ message: 'Subtitle file did not contain any usable cues' }] },
          })
        }
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to persist subtitle track' }] },
        })
      }
      return { data: { track: toTextTrackDto(result.track), segmentCount: result.segmentCount } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: textTracksContract })
}
