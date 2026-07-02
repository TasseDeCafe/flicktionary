import type {
  PracticeDueSummaryEntry,
  PracticePool,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// Buckets follow the learner's mental model (learning stage), not the render
// type: in a composed queue a warm-up gate counts as `new` (it IS the term's
// first encounter) and a rehab gate as `learning` — there is no separate
// exercises bucket.
export type QueueCounts = {
  new: number
  learning: number
  review: number
}

// Drifting New/Learning/Review counts for a (language, pool), derived from the
// landing summary. Replaces the old finite progress bar — there is no frozen
// denominator now, just live counts that shrink as the user rates.
export const getReviewCounts = (
  entry: PracticeDueSummaryEntry | null | undefined,
  pool: PracticePool,
  dailyNewAvailable: number
): QueueCounts => {
  if (!entry) return { new: 0, learning: 0, review: 0 }
  if (pool === 'production') {
    return {
      new: entry.productionNewCount,
      learning: entry.productionLearningDueCount,
      review: entry.productionReviewDueCount,
    }
  }
  return { new: dailyNewAvailable, learning: entry.learningDueCount, review: entry.reviewDueCount }
}

export const getDailyNewAvailable = (entry: PracticeDueSummaryEntry, maxNewTerms: number) => {
  if (maxNewTerms <= 0) return 0
  const remainingDailyNewTerms = Math.max(0, maxNewTerms - entry.newIntroducedTodayCount)
  return Math.min(entry.newCount, remainingDailyNewTerms)
}
