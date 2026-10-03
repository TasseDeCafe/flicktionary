import { describe, expect, it } from 'vitest'
import type { StudySession } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { deriveBooks } from './derive-books'
import { buildSessionListItems } from './session-list-items'

const session = (overrides: Partial<StudySession>): StudySession => ({
  id: 'session',
  userId: 'user',
  contentSourceId: 'source',
  textTrackId: 'track',
  nativeLanguage: 'en',
  targetLanguage: 'ru',
  cefrLevel: 'B1',
  contextBlob: null,
  processingWarnings: [],
  furthestReadSegmentIndex: null,
  resumeAfterSegmentIndex: null,
  reviewedUntilSegmentIndex: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  contentSourceTitle: 'Убик',
  contentSourceType: 'book',
  contentSourcePosterUrl: null,
  contentSourceBackdropUrl: null,
  contentSourceStillUrl: null,
  youtubeVideoId: null,
  contentSourceYear: null,
  tmdbShowId: null,
  seasonNumber: null,
  episodeNumber: null,
  showTitle: null,
  originalTitle: null,
  episodeTitle: null,
  bookPartIndex: 0,
  bookPartTitle: 'Глава 1',
  bookPartCount: 17,
  bookAuthor: 'Филип К. Дик',
  bookPinned: false,
  lastReadAt: null,
  ...overrides,
})

describe('deriveBooks', () => {
  it('groups part sessions per book and resumes at the part read most recently', () => {
    const books = deriveBooks([
      session({ id: 'p1', bookPartIndex: 0, lastReadAt: '2026-09-02T10:00:00.000Z' }),
      session({ id: 'p3', bookPartIndex: 2, lastReadAt: '2026-09-05T10:00:00.000Z' }),
      // Opened later but never read: doesn't become the current part.
      session({ id: 'p4', bookPartIndex: 3, createdAt: '2026-09-04T00:00:00.000Z' }),
      session({ id: 'movie', contentSourceType: 'movie', contentSourceId: 'm' }),
    ])
    expect(books).toHaveLength(1)
    expect(books[0]).toMatchObject({
      contentSourceId: 'source',
      title: 'Убик',
      openedPartCount: 3,
      latestActivityAt: '2026-09-05T10:00:00.000Z',
    })
    expect(books[0]!.currentSession.id).toBe('p3')
  })

  it('interleaves books with other sessions by latest reading activity', () => {
    const items = buildSessionListItems(
      [
        session({
          id: 'movie',
          contentSourceType: 'movie',
          contentSourceId: 'm',
          createdAt: '2026-09-03T00:00:00.000Z',
        }),
        session({ id: 'p1', lastReadAt: '2026-09-04T00:00:00.000Z' }),
        session({ id: 'p2', contentSourceId: 'other-book', createdAt: '2026-09-01T00:00:00.000Z' }),
      ],
      { groupTvShows: true }
    )
    expect(items.map((item) => item.key)).toEqual(['book-source', 'movie', 'book-other-book'])
  })
})
