import type { PracticeQueueFilter } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { RateValue } from '@flicktionary/ui/components/rate-buttons'
import type { ComposedQueueItem } from './composed-queue-merge'
import type { ExerciseAnswerData } from './strengthen-types'

// One durably-applied rating, keyed by the queue item it rated (object
// identity — same identity scheme as the redrill machinery). `eventId` is the
// undo handle the rating response returned; `redrill` is the in-session copy
// an 'again' rating appended (null otherwise), so a re-rate can reconcile it.
export type RatingRecord = {
  rating: RateValue
  eventId: string
  redrill: ComposedQueueItem | null
}

export type ComposedSessionSnapshot = {
  targetLanguage: string
  filter: PracticeQueueFilter
  queue: ComposedQueueItem[]
  index: number
  dailyLimitReached: boolean
  // Whether recognition intro candidates remained beyond this compose's
  // introductions — the Learn-extra CTA is dead without it, so it must
  // survive the resume round-trip like the limit flags do.
  canLearnExtra: boolean
  capNoticeShown: boolean
  sessionHard: Set<string>
  ratingRecords: Map<ComposedQueueItem, RatingRecord>
  exerciseOutcomes: Map<ComposedQueueItem, ExerciseAnswerData>
  // `${pool}:${userLookupId}` keys of introductions claimed this session — the
  // mix recap counts these, so a detour must not reset the tally.
  claimedIntroductions: Set<string>
  // Local calendar day the snapshot was taken — a session never resumes across
  // a day boundary (due-ness and the daily-new budgets reset server-side).
  dayKey: string
}

// Module-level stash of the last in-progress composed practice session (same
// pattern as the Vocabulary tab's saved-search). The composed queue is client
// state, so navigating away — the "Edit term" focus-view detour, a back
// gesture — unmounts and would otherwise discard it; re-entering would then
// compose a FRESH queue whose auto-warm-up pass parks a new batch of terms.
// Saving the session on unmount and resuming it on the next matching mount
// keeps a detour from turning an almost-finished session into a new one.
// Deliberate exits never resume: the X button and the completion screen skip
// the save (the view owns that logic), so only interrupted sessions live here.
let slot: ComposedSessionSnapshot | null = null

export const currentDayKey = (): string => new Date().toDateString()

const sameFilter = (a: PracticeQueueFilter, b: PracticeQueueFilter): boolean =>
  a.scope === b.scope &&
  a.render === b.render &&
  a.autoWarmup === b.autoWarmup &&
  a.includeOptInNew === b.includeOptInNew &&
  [...a.pools].sort().join() === [...b.pools].sort().join()

export const saveComposedSession = (snapshot: ComposedSessionSnapshot) => {
  slot = snapshot
}

export const clearComposedSession = () => {
  slot = null
}

// Consume-on-read: a snapshot resumes at most once (the resumed session
// re-saves itself on its next unmount if it's still unfinished). A stale
// snapshot (other language/filter, or from a previous day) is discarded so it
// can't resurface later.
export const takeComposedSession = (
  targetLanguage: string,
  filter: PracticeQueueFilter
): ComposedSessionSnapshot | null => {
  const snapshot = slot
  if (!snapshot) return null
  slot = null
  if (snapshot.targetLanguage !== targetLanguage) return null
  if (snapshot.dayKey !== currentDayKey()) return null
  if (!sameFilter(snapshot.filter, filter)) return null
  return snapshot
}

// Splices a deleted term out of the stashed session so a resume can't serve
// its cards/exercises (rating a soft-deleted term would fail). Only not-yet-
// reached positions are removed — consumed items must stay so the live index
// keeps pointing at the same card. Called from the chunk soft-delete
// mutations; a no-op when nothing is stashed.
export const dropTermFromComposedSession = (userLookupId: string) => {
  if (!slot) return
  const removed = new Set<ComposedQueueItem>()
  const queue = slot.queue.filter((item, position) => {
    if (position < slot!.index) return true
    const itemLookupId = item.type === 'flashcard' ? item.card.userLookupId : item.entry.userLookupId
    if (itemLookupId !== userLookupId) return true
    removed.add(item)
    return false
  })
  if (removed.size === 0 && !slot.sessionHard.has(userLookupId)) return
  for (const item of removed) {
    slot.ratingRecords.delete(item)
    slot.exerciseOutcomes.delete(item)
  }
  slot.sessionHard.delete(userLookupId)
  slot.queue = queue
}
