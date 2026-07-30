import { createHash } from 'crypto'
import { parsePastedText } from '../../utils/text-paste-parser'
import { TextTracksRepositoryInterface, DbTextTrack } from '../../transport/database/text-tracks/text-tracks-repository'
import {
  TextSegmentsRepositoryInterface,
  SegmentInsertInput,
} from '../../transport/database/text-segments/text-segments-repository'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type { HardBlockCategory } from '../../transport/third-party/anthropic/passes/moderation-pass'
import { moderateIngestText } from '../moderation/moderate-ingest-text'

export type ImportPastedTextInput = {
  contentSourceId: string
  language: string
  text: string
}

export type ImportPastedTextOutput =
  | { ok: true; track: DbTextTrack; segmentCount: number; deduped: boolean }
  | { ok: false; reason: 'parse_empty' }
  | { ok: false; reason: 'blocked'; category: HardBlockCategory }

const normalizeForHash = (segments: { text: string }[]): string => segments.map((s) => `|${s.text}`).join('\n')

export const importPastedText = async (
  input: ImportPastedTextInput,
  textTracksRepository: TextTracksRepositoryInterface,
  textSegmentsRepository: TextSegmentsRepositoryInterface,
  moderation?: { anthropicPasses: AnthropicPassesInterface }
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
    // Re-check tracks that were never verified (pre-feature or failed-open):
    // blocked content can't ride in on its own earlier import. First verdict
    // wins otherwise.
    if (moderation && existing.moderation_status === null) {
      const outcome = await moderateIngestText(parsed.map((s) => s.text).join('\n'), moderation.anthropicPasses, {
        surface: 'paste',
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
    ? await moderateIngestText(parsed.map((s) => s.text).join('\n'), moderation.anthropicPasses, { surface: 'paste' })
    : null
  if (outcome && !outcome.allowed) {
    return { ok: false, reason: 'blocked', category: outcome.category }
  }

  const track = await textTracksRepository.insertTextTrack({
    contentSourceId: input.contentSourceId,
    source: 'paste',
    language: input.language,
    externalId: null,
    hash,
    moderation: outcome?.status ? { status: outcome.status, category: outcome.category } : null,
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
