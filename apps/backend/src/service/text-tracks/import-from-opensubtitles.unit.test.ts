import { describe, expect, test, vi } from 'vitest'
import { importFromOpenSubtitles } from './import-from-opensubtitles'
import type {
  DbTextTrack,
  TextTracksRepositoryInterface,
} from '../../transport/database/text-tracks/text-tracks-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'

const srtContent = `1
00:00:01,000 --> 00:00:02,000
Hallo Welt

2
00:00:03,000 --> 00:00:04,000
Wie geht's?
`

const buildTrack = (overrides: Partial<DbTextTrack> = {}): DbTextTrack => ({
  id: '00000000-0000-0000-0000-000000000001',
  content_source_id: '00000000-0000-0000-0000-000000000002',
  source: 'opensubtitles',
  language: 'de',
  external_id: '12345',
  hash: 'hash',
  created_at: '2026-05-01T00:00:00.000Z',
  profile_built_at: null,
  profile_segment_count: null,
  profile_max_segment_index: null,
  profile_word_token_count: null,
  profile_matched_token_count: null,
  moderation_status: null,
  moderation_category: null,
  ...overrides,
})

const buildTextTracksRepository = (
  overrides: Partial<TextTracksRepositoryInterface> = {}
): TextTracksRepositoryInterface => ({
  findByContentSourceLanguageAndHash: vi.fn().mockResolvedValue(null),
  findByContentSourceLanguageAndExternalId: vi.fn().mockResolvedValue(null),
  insertTextTrack: vi.fn(),
  backfillModeration: vi.fn(),
  findById: vi.fn(),
  findByIdWithSourceType: vi.fn(),
  ...overrides,
})

const buildTextSegmentsRepository = (
  overrides: Partial<TextSegmentsRepositoryInterface> = {}
): TextSegmentsRepositoryInterface => ({
  bulkInsertSegments: vi.fn(),
  listByTrackId: vi.fn(),
  listFirstByTrackId: vi.fn(),
  searchInTrack: vi.fn(),
  findById: vi.fn(),
  listByIndexRange: vi.fn(),
  listPageAfterIndex: vi.fn(),
  getMaxIndexForTrack: vi.fn(),
  getSegmentStats: vi.fn(),
  listAroundIndex: vi.fn(),
  appendSegmentAtomic: vi.fn(),
  ...overrides,
})

describe('importFromOpenSubtitles', () => {
  test('returns the existing track without downloading when the file_id was already imported', async () => {
    const existingTrack = buildTrack()
    const textTracksRepository = buildTextTracksRepository({
      findByContentSourceLanguageAndExternalId: vi.fn().mockResolvedValue(existingTrack),
    })
    const textSegmentsRepository = buildTextSegmentsRepository({
      getSegmentStats: vi.fn().mockResolvedValue({ segmentCount: 42, maxIndex: 41 }),
    })
    const downloadSrt = vi.fn()

    const result = await importFromOpenSubtitles(
      { contentSourceId: existingTrack.content_source_id, fileId: 12345, language: 'de' },
      { textTracksRepository, textSegmentsRepository, downloadSrt }
    )

    expect(result).toEqual({ ok: true, track: existingTrack, segmentCount: 42, deduped: true })
    // The whole point of the pre-check: the quota-counted download never fires.
    expect(downloadSrt).not.toHaveBeenCalled()
    expect(textTracksRepository.findByContentSourceLanguageAndExternalId).toHaveBeenCalledWith({
      contentSourceId: existingTrack.content_source_id,
      source: 'opensubtitles',
      language: 'de',
      externalId: '12345',
    })
    expect(textTracksRepository.insertTextTrack).not.toHaveBeenCalled()
  })

  test('downloads and imports when the file_id is new for this source and language', async () => {
    const insertedTrack = buildTrack()
    const textTracksRepository = buildTextTracksRepository({
      insertTextTrack: vi.fn().mockResolvedValue(insertedTrack),
    })
    const textSegmentsRepository = buildTextSegmentsRepository()
    const downloadSrt = vi.fn().mockResolvedValue(srtContent)

    const result = await importFromOpenSubtitles(
      { contentSourceId: insertedTrack.content_source_id, fileId: 12345, language: 'de' },
      { textTracksRepository, textSegmentsRepository, downloadSrt }
    )

    expect(result).toEqual({ ok: true, track: insertedTrack, segmentCount: 2, deduped: false })
    expect(downloadSrt).toHaveBeenCalledWith(12345)
    expect(textTracksRepository.insertTextTrack).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'opensubtitles', externalId: '12345' })
    )
    expect(textSegmentsRepository.bulkInsertSegments).toHaveBeenCalledWith(insertedTrack.id, [
      expect.objectContaining({ text: 'Hallo Welt' }),
      expect.objectContaining({ text: "Wie geht's?" }),
    ])
  })
})
