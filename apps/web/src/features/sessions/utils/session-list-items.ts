import type { StudySession } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { deriveTvShows, type TvShowGroup } from './derive-tv-shows'
import { deriveBooks, type BookGroup } from './derive-books'

export type SessionListItem =
  | { kind: 'group'; key: string; sortKey: string; group: TvShowGroup }
  | { kind: 'book'; key: string; sortKey: string; book: BookGroup }
  | { kind: 'session'; key: string; sortKey: string; session: StudySession }

// TV sessions collapse into one expandable group per show and book part
// sessions into one entry per book; every other source type stays an
// individual row. Groups and rows interleave by recency so an
// active show bubbles up alongside recent movies/texts. Callers that filter to
// a non-TV source type pass groupTvShows: false — those lists never contain a
// group. Shared by the Sessions list and the dashboard's Recent section.
export const buildSessionListItems = (
  sessions: StudySession[],
  options: { groupTvShows: boolean }
): SessionListItem[] => {
  const groups = options.groupTvShows ? deriveTvShows(sessions) : []
  const loose = sessions.filter((s) => s.contentSourceType !== 'tv' && s.contentSourceType !== 'book')
  const merged: SessionListItem[] = [
    ...deriveBooks(sessions).map((book) => ({
      kind: 'book' as const,
      key: `book-${book.contentSourceId}`,
      sortKey: book.latestActivityAt,
      book,
    })),
    ...groups.map((group) => ({
      kind: 'group' as const,
      key: `show-${group.tmdbShowId}`,
      sortKey: group.latestCreatedAt,
      group,
    })),
    ...loose.map((session) => ({ kind: 'session' as const, key: session.id, sortKey: session.createdAt, session })),
  ]
  merged.sort((a, b) => b.sortKey.localeCompare(a.sortKey))
  return merged
}
