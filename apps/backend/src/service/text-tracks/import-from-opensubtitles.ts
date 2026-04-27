import { downloadSrtByFileId } from '../../transport/third-party/opensubtitles/opensubtitles-client'
import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { importSrt, ImportSrtOutput } from './import-srt'

export type ImportFromOpenSubtitlesInput = {
  contentSourceId: string
  fileId: number
  language: string
}

export const importFromOpenSubtitles = async (
  input: ImportFromOpenSubtitlesInput,
  textTracksRepository: TextTracksRepositoryInterface,
  textSegmentsRepository: TextSegmentsRepositoryInterface
): Promise<ImportSrtOutput> => {
  let srt: string
  try {
    srt = await downloadSrtByFileId(input.fileId)
  } catch (e) {
    logCustomErrorMessageAndError(`importFromOpenSubtitles download, fileId = ${input.fileId}`, e)
    return { ok: false, reason: 'persist_failed' }
  }

  return importSrt(
    {
      contentSourceId: input.contentSourceId,
      source: 'opensubtitles',
      language: input.language,
      externalId: String(input.fileId),
      srtContent: srt,
    },
    textTracksRepository,
    textSegmentsRepository
  )
}
