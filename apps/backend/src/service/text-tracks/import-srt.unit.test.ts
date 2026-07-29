import { describe, expect, test, vi } from 'vitest'
import { importSrt } from './import-srt'
import type {
  DbTextTrack,
  TextTracksRepositoryInterface,
} from '../../transport/database/text-tracks/text-tracks-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'

const srtContent = `1
00:00:01,000 --> 00:00:02,000
Hello
`

const buildTrack = (overrides: Partial<DbTextTrack> = {}): DbTextTrack => ({
  id: '00000000-0000-0000-0000-000000000001',
  content_source_id: '00000000-0000-0000-0000-000000000002',
  source: 'upload',
  language: 'en',
  external_id: null,
  hash: 'hash',
  created_at: '2026-05-01T00:00:00.000Z',
  profile_built_at: null,
  profile_segment_count: null,
  profile_max_segment_index: null,
  profile_word_token_count: null,
  profile_matched_token_count: null,
  ...overrides,
})

describe('importSrt', () => {
  test('dedupes only within the same content source and language', async () => {
    const existingTrack = buildTrack()
    const textTracksRepository: TextTracksRepositoryInterface = {
      findByContentSourceLanguageAndHash: vi.fn().mockResolvedValue(existingTrack),
      findByContentSourceLanguageAndExternalId: vi.fn(),
      insertTextTrack: vi.fn(),
      findById: vi.fn(),
      findByIdWithSourceType: vi.fn(),
    }
    const textSegmentsRepository: TextSegmentsRepositoryInterface = {
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
    }

    const result = await importSrt(
      {
        contentSourceId: existingTrack.content_source_id,
        source: 'upload',
        language: existingTrack.language,
        externalId: null,
        srtContent,
      },
      textTracksRepository,
      textSegmentsRepository
    )

    expect(result).toEqual({ ok: true, track: existingTrack, segmentCount: 1, deduped: true })
    expect(textTracksRepository.findByContentSourceLanguageAndHash).toHaveBeenCalledWith({
      contentSourceId: existingTrack.content_source_id,
      language: existingTrack.language,
      hash: expect.any(String),
    })
    expect(textTracksRepository.insertTextTrack).not.toHaveBeenCalled()
    expect(textSegmentsRepository.bulkInsertSegments).not.toHaveBeenCalled()
  })
})
