import type {
  PracticeDueSummaryEntry,
  PracticePool,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { ComposedQueueItem } from './composed-queue-merge'

// Buckets follow the learner's mental model (learning stage), not the render
// type: `new` is a term introduced by THIS session's compose, `warmup` a
// returning warm-up gate from an earlier compose (the landing's "warming up"
// stage), a rehab gate counts as `learning` — there is no separate exercises
// bucket. The session-plan card on the landing shows these same four buckets,
// computed by the server from the same plan composition materializes.
export type QueueCounts = {
  new: number
  warmup: number
  learning: number
  review: number
}

// Remaining counts for the not-yet-reached tail of a composed session queue.
export const getRemainingCounts = (queue: ComposedQueueItem[], index: number): QueueCounts =>
  queue.slice(index).reduce<QueueCounts>(
    (counts, item) => {
      if (item.type === 'exercise') {
        // (Bonus entries — null origin — never reach the composed queue.)
        if (item.isNewIntroduction) counts.new += 1
        else if (item.entry.origin === 'onboarding') counts.warmup += 1
        else counts.learning += 1
        return counts
      }
      if (item.requeuedForAgain) {
        counts.learning += 1
        return counts
      }
      switch (item.card.srsState) {
        case null:
          counts.new += 1
          break
        case 'review':
          counts.review += 1
          break
        case 'new':
        case 'learning':
        case 'relearning':
          counts.learning += 1
          break
      }
      return counts
    },
    { new: 0, warmup: 0, learning: 0, review: 0 }
  )

// Drifting New/Learning/Review counts for a (language, pool), derived from the
// landing summary — feeds the reading-mode status chips, which serve no
// warm-up gates (warmup stays 0). Both pools' `new` counts are capped by the
// COMBINED remaining daily budget (newIntroducedTodayCount spans both pools'
// citation introductions) — the backend refuses intros past it, so
// advertising more would promise terms reading mode can't serve. Replaces the
// old finite progress bar — there is no frozen denominator now, just live
// counts that shrink as the user rates.
export const getReviewCounts = (
  entry: PracticeDueSummaryEntry | null | undefined,
  pool: PracticePool,
  maxNewTerms: number
): QueueCounts => {
  if (!entry) return { new: 0, warmup: 0, learning: 0, review: 0 }
  const remainingBudget = Math.max(0, maxNewTerms - entry.newIntroducedTodayCount)
  if (pool === 'production') {
    return {
      new: Math.min(entry.productionNewCount, remainingBudget),
      warmup: 0,
      learning: entry.productionLearningDueCount,
      review: entry.productionReviewDueCount,
    }
  }
  return {
    new: Math.min(entry.newCount, remainingBudget),
    warmup: 0,
    learning: entry.learningDueCount,
    review: entry.reviewDueCount,
  }
}
