import type { BookPinsRepositoryInterface } from '../../transport/database/book-pins/book-pins-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { bookDailyQuota } from './book-priority'
import { clampPracticeSessionLimits } from './review-caps'

export type BookQuotaDependencies = {
  bookPinsRepository: BookPinsRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
}

export type BookQuota = {
  contentSourceId: string
  quota: number
  introducedToday: number
  remaining: number
}

// Today's pinned-book quota for a language, or null when nothing is pinned.
// The quota is a share of the combined daily new budget; usage counts
// introductions stamped for a book stream today (any book — replacing the pin
// mid-day doesn't refill it). Every introduction-order consumer takes
// `remaining` from here, so the queue, reading mode and Up next agree.
export const resolveBookQuota = async (
  userId: string,
  targetLanguage: string,
  deps: BookQuotaDependencies
): Promise<BookQuota | null> => {
  const pin = await deps.bookPinsRepository.getPin(userId, targetLanguage)
  if (!pin) return null
  const [limits, introducedToday] = await Promise.all([
    deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(userId, targetLanguage),
    deps.bookPinsRepository.countBookIntroductionsToday(userId, targetLanguage),
  ])
  const quota = bookDailyQuota(clampPracticeSessionLimits(limits).maxNewTerms)
  return {
    contentSourceId: pin.content_source_id,
    quota,
    introducedToday,
    remaining: Math.max(0, quota - introducedToday),
  }
}
