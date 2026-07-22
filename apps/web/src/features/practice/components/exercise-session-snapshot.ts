import type { StrengthenExerciseEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { ExerciseAnswerData } from './strengthen-types'
import { currentDayKey } from './composed-session-snapshot'

// Identity of one dedicated exercise session (Strengthen or Warm-up): the
// scope params that select the same server-side queue. Two keys match ⇔
// re-entering the route would rebuild the same session, so a stashed snapshot
// may resume in its place.
export const exerciseSessionKey = (parts: {
  mode: 'strengthen' | 'warmup'
  targetLanguage: string
  pool?: string
  studySessionId?: string
  sessionHard?: readonly string[]
  mix?: readonly string[]
}): string =>
  JSON.stringify([
    parts.mode,
    parts.targetLanguage,
    parts.pool ?? null,
    parts.studySessionId ?? null,
    [...(parts.sessionHard ?? [])].sort(),
    parts.mix ?? [],
  ])

export type ExerciseSessionSnapshot = {
  key: string
  queue: StrengthenExerciseEntry[]
  index: number
  correctCount: number
  // Outcome of the current exercise when it was answered but not yet advanced
  // past. The server consumed the exercise on answer, so a resume must render
  // it read-only instead of remounting the live component (whose re-submit
  // would be rejected).
  currentOutcome: ExerciseAnswerData | null
  dailyLimitReached: boolean
  // Local calendar day the snapshot was taken — a session never resumes across
  // a day boundary (rehab credit and daily budgets reset server-side).
  dayKey: string
}

// Module-level stash of the last in-progress Strengthen/Warm-up session (same
// pattern as composed-session-snapshot.ts). The queue is client state seeded
// by a one-shot start mutation, so the edit-term focus-view detour unmounts
// and would discard it; re-entering would then start a FRESH session and
// re-serve every remaining gate from position 0. Deliberate exits (X button,
// completion screens) never stash — only interrupted sessions live here.
let slot: ExerciseSessionSnapshot | null = null

export const saveExerciseSession = (snapshot: ExerciseSessionSnapshot) => {
  slot = snapshot
}

export const clearExerciseSession = () => {
  slot = null
}

// Consume-on-read: a snapshot resumes at most once (the resumed session
// re-saves itself on its next unmount if it's still unfinished). A stale
// snapshot (other session scope, or from a previous day) is discarded so it
// can't resurface later.
export const takeExerciseSession = (key: string): ExerciseSessionSnapshot | null => {
  const snapshot = slot
  if (!snapshot) return null
  slot = null
  if (snapshot.key !== key) return null
  if (snapshot.dayKey !== currentDayKey()) return null
  return snapshot
}

// Splices a deleted term out of the stashed session so a resume can't serve
// its exercises (answering for a soft-deleted term would fail). Only not-yet-
// passed positions are removed — earlier entries stay so the live index keeps
// pointing at the same exercise. Called from the chunk soft-delete mutations;
// a no-op when nothing is stashed.
export const dropTermFromExerciseSession = (userLookupId: string) => {
  if (!slot) return
  // The stashed outcome belongs to the entry at the live index — dropping that
  // entry shifts the index onto the next one, which was never answered. A
  // correct answer leaves the tally with it, or the completion screen could
  // report more correct than the shortened queue's total.
  if (slot.queue[slot.index]?.userLookupId === userLookupId) {
    if (slot.currentOutcome?.correct) slot.correctCount = Math.max(0, slot.correctCount - 1)
    slot.currentOutcome = null
  }
  slot.queue = slot.queue.filter((entry, position) => position < slot!.index || entry.userLookupId !== userLookupId)
}
