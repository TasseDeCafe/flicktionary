import type { ComposedQueueItem } from '../components/composed-queue-merge'

// The Daily Mix: one dashboard CTA that clears every language's practice queue
// sequentially. The `mix` search param on the composed route carries the FULL
// ordered language chain (done + current + upcoming); position derives from
// the route's language param, so the URL is stable across the whole run and a
// refresh keeps the chain.

// Most-recently-practiced first (the language the user is actively working on
// leads), never-practiced last, ties alphabetical for stability.
export const orderMixLanguages = <T extends { targetLanguage: string; lastPracticedAt: string | null }>(
  entries: readonly T[]
): T[] =>
  [...entries].sort((a, b) => {
    if (a.lastPracticedAt !== b.lastPracticedAt) {
      if (a.lastPracticedAt === null) return 1
      if (b.lastPracticedAt === null) return -1
      return b.lastPracticedAt.localeCompare(a.lastPracticedAt)
    }
    return a.targetLanguage.localeCompare(b.targetLanguage)
  })

// What the session-plan card sums for one language — the banner must show the
// same arithmetic as the per-language practice landing, so no surprises.
export const plannedTotal = (counts: { new: number; warmup: number; learning: number; review: number }): number =>
  counts.new + counts.warmup + counts.learning + counts.review

// Chip-row truncation: past `max` languages the queue reads as noise — show
// the head and fold the rest into "+N more".
export const truncateMixChips = <T>(chips: readonly T[], max = 6): { visible: T[]; hiddenCount: number } =>
  chips.length <= max
    ? { visible: [...chips], hiddenCount: 0 }
    : { visible: chips.slice(0, max - 1), hiddenCount: chips.length - (max - 1) }

// Where `targetLanguage` sits in the chain. A language not in the chain (hand
// edited URL) degrades to "no mix".
export const splitMixChain = (
  mix: readonly string[] | undefined,
  targetLanguage: string
): { done: string[]; upcoming: string[] } | null => {
  if (!mix || mix.length === 0) return null
  const position = mix.indexOf(targetLanguage)
  if (position === -1) return null
  return { done: mix.slice(0, position), upcoming: mix.slice(position + 1) }
}

export type MixRecap = { cardsDone: number; newIntroduced: number; warmedUp: number }

// Completed-session tally for the interstitial, derived from the composed
// view's in-memory records. Redrill copies of 'again' cards are reps of a card
// already counted, not extra cards. New introductions count by CLAIM, not by
// answer: the introduction is committed server-side (daily slot spent) the
// moment its gate is displayed, so a claimed-then-skipped generating/failed
// exercise is still an introduction. Warm-ups are the answered
// onboarding-origin gates that weren't introductions.
export const computeMixRecap = (params: {
  ratedItems: readonly ComposedQueueItem[]
  answeredExercises: readonly ComposedQueueItem[]
  claimedIntroductionCount: number
}): MixRecap => {
  const ratedCards = params.ratedItems.filter((item) => item.type === 'flashcard' && !item.requeuedForAgain).length
  const answered = params.answeredExercises.filter((item) => item.type === 'exercise')
  const warmedUp = answered.filter(
    (item) => item.type === 'exercise' && !item.isNewIntroduction && item.entry.origin === 'onboarding'
  ).length
  return { cardsDone: ratedCards + answered.length, newIntroduced: params.claimedIntroductionCount, warmedUp }
}
