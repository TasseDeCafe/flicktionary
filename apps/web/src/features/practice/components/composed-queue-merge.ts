import type {
  PracticeQueueItem,
  ReviewTerm,
  StrengthenExerciseEntry,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { entryKey } from './exercise-queue-merge'

// Local queue item of the composed practice session. Flashcard items carry the
// same redrill/retry bookkeeping the dedicated flashcard queue used; exercise
// items wrap the served entry plus the compose's isNewIntroduction verdict
// (this compose parked the term = the "New" chip bucket; a backlog gate from
// an earlier compose = "Warm-up").
export type ComposedQueueItem =
  | {
      type: 'flashcard'
      card: ReviewTerm
      retryCount: number
      // True for in-session redrill copies of 'again'-rated cards (classifies
      // the item into the learning bucket of the remaining counts).
      requeuedForAgain: boolean
    }
  | { type: 'exercise'; entry: StrengthenExerciseEntry; isNewIntroduction: boolean }

export const toComposedQueueItem = (item: PracticeQueueItem): ComposedQueueItem =>
  item.type === 'flashcard'
    ? { type: 'flashcard', card: item.card, retryCount: 0, requeuedForAgain: false }
    : { type: 'exercise', entry: item.entry, isNewIntroduction: item.isNewIntroduction }

// The heterogeneous-queue counterpart of mergePlaceholders: swap
// not-yet-reached 'generating' exercise placeholders for their refreshed
// 'ready'/'failed' entry, matched by the same (pool, userLookupId) key.
// Flashcard items and already-passed positions are never touched, and the
// refresh NEVER appends items (one-shot snapshot rule) — a graduated term or a
// backlog shift server-side changes the refresh result set, but only existing
// keys upgrade. Returns the same array reference when nothing changed.
export const mergeComposedPlaceholders = (
  prev: ComposedQueueItem[],
  fresh: PracticeQueueItem[],
  fromIndex: number
): ComposedQueueItem[] => {
  const freshByKey = new Map(
    fresh.flatMap((item) => (item.type === 'exercise' ? [[entryKey(item.entry), item.entry] as const] : []))
  )
  let changed = false
  const next = prev.map((item, i) => {
    if (i < fromIndex || item.type !== 'exercise' || item.entry.status !== 'generating') return item
    const updated = freshByKey.get(entryKey(item.entry))
    if (updated && (updated.status === 'ready' || updated.status === 'failed')) {
      changed = true
      // Keep the ORIGINAL compose's isNewIntroduction: the refresh is
      // serve-only (it never parks), so its items all report false — trusting
      // it would silently demote a just-introduced term to the Warm-up chip.
      return { type: 'exercise' as const, entry: updated, isNewIntroduction: item.isNewIntroduction }
    }
    return item
  })
  return changed ? next : prev
}
