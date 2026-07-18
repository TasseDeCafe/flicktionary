import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'
import { ContentSourcesRepository } from '../content-sources/content-sources-repository'
import { TextTracksRepository } from '../text-tracks/text-tracks-repository'
import { TextSegmentsRepository } from './text-segments-repository'

// Keyset pagination over segments. The pager must advance through actual
// rows: extension-supplied indices are not guaranteed dense, so a sparse
// index space (huge gaps, arbitrary max) has to cost pages of real rows —
// never a walk of the raw index range.
describe('text-segments-repository integration tests', () => {
  const contentSourcesRepository = ContentSourcesRepository()
  const textTracksRepository = TextTracksRepository()
  const repository = TextSegmentsRepository()

  const createTrackFixture = async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const unique = __generateUniqueId('segments-track')
    const source = await contentSourcesRepository.insertContentSource({
      type: 'text',
      title: unique,
      language: 'ru',
      metadata: {},
      createdByUserId: userId,
    })
    const track = await textTracksRepository.insertTextTrack({
      contentSourceId: source.id,
      source: 'paste',
      language: 'ru',
      externalId: null,
      hash: unique,
    })
    return track
  }

  test('listPageAfterIndex pages through sparse indices in order, honoring the upper bound', async () => {
    const track = await createTrackFixture()
    // Deliberately sparse: gaps of thousands and a huge final index.
    const indices = [0, 3, 4000, 4001, 900_000_000]
    await repository.bulkInsertSegments(
      track.id,
      indices.map((index) => ({ index, text: `сегмент ${index}`, startMs: null, endMs: null }))
    )

    const firstPage = await repository.listPageAfterIndex({ textTrackId: track.id, afterIndex: null, limit: 2 })
    expect(firstPage.map((s) => s.index)).toEqual([0, 3])

    const secondPage = await repository.listPageAfterIndex({ textTrackId: track.id, afterIndex: 3, limit: 2 })
    expect(secondPage.map((s) => s.index)).toEqual([4000, 4001])

    // A short page signals the end — the huge index costs one row, not a
    // walk of the gap.
    const lastPage = await repository.listPageAfterIndex({ textTrackId: track.id, afterIndex: 4001, limit: 2 })
    expect(lastPage.map((s) => s.index)).toEqual([900_000_000])

    const bounded = await repository.listPageAfterIndex({
      textTrackId: track.id,
      afterIndex: null,
      limit: 10,
      toIndexInclusive: 4000,
    })
    expect(bounded.map((s) => s.index)).toEqual([0, 3, 4000])
  })

  test('listPageAfterIndex returns empty for an empty track', async () => {
    const track = await createTrackFixture()
    const page = await repository.listPageAfterIndex({ textTrackId: track.id, afterIndex: null, limit: 5 })
    expect(page).toEqual([])
  })
})
