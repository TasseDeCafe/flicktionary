import { createHash } from 'crypto'
import { parsePastedText } from '../../utils/text-paste-parser'
import { TextTracksRepositoryInterface, DbTextTrack } from '../../transport/database/text-tracks/text-tracks-repository'
import {
  TextSegmentsRepositoryInterface,
  SegmentInsertInput,
} from '../../transport/database/text-segments/text-segments-repository'

export type ImportPastedTextInput = {
  contentSourceId: string
  language: string
  text: string
}

export type ImportPastedTextOutput =
  { ok: true; track: DbTextTrack; segmentCount: number; deduped: boolean } | { ok: false; reason: 'parse_empty' }

const normalizeForHash = (segments: { text: string }[]): string => segments.map((s) => `|${s.text}`).join('\n')

export const importPastedText = async (
  input: ImportPastedTextInput,
  textTracksRepository: TextTracksRepositoryInterface,
  textSegmentsRepository: TextSegmentsRepositoryInterface
): Promise<ImportPastedTextOutput> => {
  const parsed = parsePastedText(input.text)
  if (parsed.length === 0) {
    return { ok: false, reason: 'parse_empty' }
  }

  const hash = createHash('sha256').update(normalizeForHash(parsed)).digest('hex')

  const existing = await textTracksRepository.findByContentSourceLanguageAndHash({
    contentSourceId: input.contentSourceId,
    language: input.language,
    hash,
  })
  if (existing) {
    return { ok: true, track: existing, segmentCount: parsed.length, deduped: true }
  }

  const track = await textTracksRepository.insertTextTrack({
    contentSourceId: input.contentSourceId,
    source: 'paste',
    language: input.language,
    externalId: null,
    hash,
  })

  const segments: SegmentInsertInput[] = parsed.map((p) => ({
    index: p.index,
    text: p.text,
    startMs: null,
    endMs: null,
  }))
  await textSegmentsRepository.bulkInsertSegments(track.id, segments)
  return { ok: true, track, segmentCount: parsed.length, deduped: false }
}
