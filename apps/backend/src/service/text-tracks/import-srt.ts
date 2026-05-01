import { createHash } from 'crypto'
import { parseSrt } from '../../utils/srt-parser'
import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { TextTracksRepositoryInterface, DbTextTrack } from '../../transport/database/text-tracks/text-tracks-repository'
import {
  TextSegmentsRepositoryInterface,
  SegmentInsertInput,
} from '../../transport/database/text-segments/text-segments-repository'
import type { Database } from '../../transport/database/database.public.types'

type TextTrackSource = Database['public']['Enums']['text_track_source']

export type ImportSrtInput = {
  contentSourceId: string
  source: TextTrackSource
  language: string
  externalId: string | null
  srtContent: string
}

export type ImportSrtOutput =
  | { ok: true; track: DbTextTrack; segmentCount: number; deduped: boolean }
  | { ok: false; reason: 'parse_empty' | 'persist_failed' }

const normalizeForHash = (segments: { text: string; startMs: number; endMs: number }[]): string =>
  segments.map((s) => `${s.startMs}-${s.endMs}|${s.text}`).join('\n')

export const importSrt = async (
  input: ImportSrtInput,
  textTracksRepository: TextTracksRepositoryInterface,
  textSegmentsRepository: TextSegmentsRepositoryInterface
): Promise<ImportSrtOutput> => {
  let parsed
  try {
    parsed = parseSrt(input.srtContent)
  } catch (e) {
    logCustomErrorMessageAndError(`importSrt parse, contentSourceId = ${input.contentSourceId}`, e)
    return { ok: false, reason: 'parse_empty' }
  }
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
    source: input.source,
    language: input.language,
    externalId: input.externalId,
    hash,
  })
  if (!track) {
    return { ok: false, reason: 'persist_failed' }
  }

  const segments: SegmentInsertInput[] = parsed.map((p) => ({
    index: p.index,
    text: p.text,
    startMs: p.startMs,
    endMs: p.endMs,
  }))
  const inserted = await textSegmentsRepository.bulkInsertSegments(track.id, segments)
  if (!inserted) {
    return { ok: false, reason: 'persist_failed' }
  }
  return { ok: true, track, segmentCount: parsed.length, deduped: false }
}
