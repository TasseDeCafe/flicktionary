import type { StrengthenExerciseEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// A warm-up serves a MIXED queue (recognition + production), so a both-skills
// term has two entries sharing one userLookupId — keyed by (pool, userLookupId)
// so a refreshed recognition exercise never overwrites the production
// placeholder of the same term (or vice versa).
export const entryKey = (entry: StrengthenExerciseEntry): string => `${entry.pool}:${entry.userLookupId}`

// Replace not-yet-reached 'generating' placeholders with their refreshed
// 'ready'/'failed' counterpart (matched by pool+term), leaving everything
// already passed untouched. This is the in-place swap behind the live-update
// polling: a placeholder turns into a real exercise (or a clear failed state)
// without the user manually refreshing. Returns the same array reference when
// nothing changed, so callers can skip a re-render.
export const mergePlaceholders = (
  prev: StrengthenExerciseEntry[],
  fresh: StrengthenExerciseEntry[],
  fromIndex: number
): StrengthenExerciseEntry[] => {
  const byTerm = new Map(fresh.map((e) => [entryKey(e), e]))
  let changed = false
  const next = prev.map((entry, i) => {
    if (i < fromIndex || entry.status !== 'generating') return entry
    const updated = byTerm.get(entryKey(entry))
    if (updated && (updated.status === 'ready' || updated.status === 'failed')) {
      changed = true
      return updated
    }
    return entry
  })
  return changed ? next : prev
}
