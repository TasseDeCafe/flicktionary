import { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { importSrt, ImportSrtOutput } from './import-srt'

export type ImportFromOpenSubtitlesInput = {
  contentSourceId: string
  fileId: number
  language: string
}

export type ImportFromOpenSubtitlesDependencies = {
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  // Injected seam: every call spends from the shared OpenSubtitles daily
  // download quota, so tests must be able to assert it is NOT called.
  downloadSrt: (fileId: number) => Promise<string>
}

export const importFromOpenSubtitles = async (
  input: ImportFromOpenSubtitlesInput,
  deps: ImportFromOpenSubtitlesDependencies
): Promise<ImportSrtOutput> => {
  // A file_id we already ingested for this content source + language means the
  // segments are in the DB — return the existing track without downloading.
  // This check must run BEFORE the network call: importSrt's hash dedupe only
  // kicks in after the quota is already spent.
  const existing = await deps.textTracksRepository.findByContentSourceLanguageAndExternalId({
    contentSourceId: input.contentSourceId,
    source: 'opensubtitles',
    language: input.language,
    externalId: String(input.fileId),
  })
  if (existing) {
    const stats = await deps.textSegmentsRepository.getSegmentStats(existing.id)
    return { ok: true, track: existing, segmentCount: stats.segmentCount, deduped: true }
  }

  const srt = await deps.downloadSrt(input.fileId)
  return importSrt(
    {
      contentSourceId: input.contentSourceId,
      source: 'opensubtitles',
      language: input.language,
      externalId: String(input.fileId),
      srtContent: srt,
    },
    deps.textTracksRepository,
    deps.textSegmentsRepository
  )
}
