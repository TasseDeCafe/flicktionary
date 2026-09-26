import type { StudySession } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export type BookGroup = {
  contentSourceId: string
  title: string
  author: string | null
  language: string
  partCount: number | null
  // The user's pinned book for its language (words from it are prioritized).
  pinned: boolean
  // The part session read most recently (else the latest opened) — where
  // tapping the book resumes.
  currentSession: StudySession
  openedPartCount: number
  latestActivityAt: string
}

const activityAt = (session: StudySession): string => session.lastReadAt ?? session.createdAt

// Collapses a book's part sessions (one per opened part) into one entry per
// book, keyed by content source. Non-book sessions are ignored. Groups sort
// most-recently-read first.
export const deriveBooks = (sessions: readonly StudySession[]): BookGroup[] => {
  const groups = new Map<string, BookGroup>()
  for (const session of sessions) {
    if (session.contentSourceType !== 'book') continue
    const existing = groups.get(session.contentSourceId)
    if (!existing) {
      groups.set(session.contentSourceId, {
        contentSourceId: session.contentSourceId,
        title: session.contentSourceTitle ?? '',
        author: session.bookAuthor,
        language: session.targetLanguage,
        partCount: session.bookPartCount,
        pinned: session.bookPinned,
        currentSession: session,
        openedPartCount: 1,
        latestActivityAt: activityAt(session),
      })
      continue
    }
    existing.openedPartCount += 1
    if (activityAt(session) > existing.latestActivityAt) {
      existing.latestActivityAt = activityAt(session)
      existing.currentSession = session
    }
  }
  return [...groups.values()].sort((a, b) => b.latestActivityAt.localeCompare(a.latestActivityAt))
}
