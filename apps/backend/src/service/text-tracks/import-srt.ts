import { createHash } from 'crypto'
import { parseSrt } from '../../utils/srt-parser'
import { TextTracksRepositoryInterface, DbTextTrack } from '../../transport/database/text-tracks/text-tracks-repository'
import {
  TextSegmentsRepositoryInterface,
  SegmentInsertInput,
} from '../../transport/database/text-segments/text-segments-repository'
import type { Database } from '../../transport/database/database.public.types'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type { HardBlockCategory } from '../../transport/third-party/anthropic/passes/moderation-pass'
import { moderateIngestText } from '../moderation/moderate-ingest-text'

type TextTrackSource = Database['public']['Enums']['text_track_source']

export type ImportSrtInput = {
  contentSourceId: string
  source: TextTrackSource
  language: string
  externalId: string | null
  srtContent: string
}

// Moderation is an OPT-IN dep: only the user-upload router provides it.
// importFromOpenSubtitles delegates here too, and third-party catalog
// subtitles are deliberately not moderated — omitting the dep keeps that
// path (and its tests) moderation-free.
export type ImportSrtModerationDep = { anthropicPasses: AnthropicPassesInterface }

// `parse_empty` is the only legitimate domain failure (malformed/empty SRT —
// the system is fine, the file isn't). `blocked` rejects content the
// moderation classifier hard-blocked. Infra failures throw and propagate to
// the boundary.
export type ImportSrtOutput =
  | { ok: true; track: DbTextTrack; segmentCount: number; deduped: boolean }
  | { ok: false; reason: 'parse_empty' }
  | { ok: false; reason: 'blocked'; category: HardBlockCategory }

const normalizeForHash = (segments: { text: string; startMs: number; endMs: number }[]): string =>
  segments.map((s) => `${s.startMs}-${s.endMs}|${s.text}`).join('\n')

export const importSrt = async (
  input: ImportSrtInput,
  textTracksRepository: TextTracksRepositoryInterface,
  textSegmentsRepository: TextSegmentsRepositoryInterface,
  moderation?: ImportSrtModerationDep
): Promise<ImportSrtOutput> => {
  let parsed
  try {
    parsed = parseSrt(input.srtContent)
  } catch {
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
    // A deduped track was accepted before, but possibly pre-feature or during
    // a moderation outage (status NULL) — re-check so blocked content can't
    // ride in on its own earlier import. First verdict wins otherwise.
    if (moderation && existing.moderation_status === null) {
      const outcome = await moderateIngestText(parsed.map((s) => s.text).join('\n'), moderation.anthropicPasses, {
        surface: 'srt-upload',
      })
      if (!outcome.allowed) return { ok: false, reason: 'blocked', category: outcome.category }
      if (outcome.status) {
        await textTracksRepository.backfillModeration(existing.id, {
          status: outcome.status,
          category: outcome.category,
        })
      }
    }
    return { ok: true, track: existing, segmentCount: parsed.length, deduped: true }
  }

  const outcome = moderation
    ? await moderateIngestText(parsed.map((s) => s.text).join('\n'), moderation.anthropicPasses, {
        surface: 'srt-upload',
      })
    : null
  if (outcome && !outcome.allowed) {
    return { ok: false, reason: 'blocked', category: outcome.category }
  }

  const track = await textTracksRepository.insertTextTrack({
    contentSourceId: input.contentSourceId,
    source: input.source,
    language: input.language,
    externalId: input.externalId,
    hash,
    moderation: outcome?.status ? { status: outcome.status, category: outcome.category } : null,
  })

  const segments: SegmentInsertInput[] = parsed.map((p) => ({
    index: p.index,
    text: p.text,
    startMs: p.startMs,
    endMs: p.endMs,
  }))
  await textSegmentsRepository.bulkInsertSegments(track.id, segments)
  return { ok: true, track, segmentCount: parsed.length, deduped: false }
}
