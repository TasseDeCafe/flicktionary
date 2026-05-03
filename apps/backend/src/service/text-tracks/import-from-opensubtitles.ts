import { downloadSrtByFileId } from '../../transport/third-party/opensubtitles/opensubtitles-client'
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
  const srt = await downloadSrtByFileId(input.fileId)
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
