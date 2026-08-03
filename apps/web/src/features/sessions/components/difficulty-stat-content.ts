import type { SessionDifficulty } from '../api/sessions-hooks'

// Whether SessionDifficultyStat renders anything for this difficulty (kept in
// sync with its branches). The session header wraps the stat in a button that
// opens the coverage sheet, so it must skip the wrapper exactly when the stat
// is empty — an empty button would be a keyboard-focusable nothing.
export const hasDifficultyStatContent = (difficulty: SessionDifficulty | undefined): boolean => {
  if (!difficulty) return false
  if (difficulty.status === 'pending') return true
  if (difficulty.status !== 'available') return false
  if (difficulty.expectedCoveragePercent !== null && difficulty.label !== null) return true
  return (difficulty.unknownLemmaCount ?? 0) > 0
}
