// State machine for the merged declaration sheet
// (checkpoint → claims → sweep → done).
// Kept pure so the step-inclusion matrix, the transition rules, and the
// combined-undo outcome handling are unit-testable without mounting the
// overlay. The component dispatches events; async work (mutations, the exact
// span preview) stays in the component.

export type DeclarationSheetPhase = 'checkpoint' | 'claims' | 'sweep' | 'done' | 'undoError'

export type DeclarationSheetState = {
  phase: DeclarationSheetPhase
  // Which action steps this run includes (fixed at open; the sweep step can
  // still be skipped later if its exact count resolves to 0).
  checkpointIncluded: boolean
  sweepIncluded: boolean
  // A concurrent pointer advance rejected the collect — the checkpoint step
  // shows an inline retry instead of a toast.
  collectConflict: boolean
  checkpoint: { checkpointId: string | null; creditedCount: number } | null
  // The claims step ("saved but never practiced"): `claimsCount` is how many
  // candidates the run has to offer — known at open for a claims re-entry,
  // otherwise only once the collect returns them. 0 means no claims step.
  claimsCount: number
  claims: { assertedCount: number } | null
  sweep: { markedCount: number; sweepBatchId: string | null } | null
  undo: { checkpointFailed: boolean; sweepFailed: boolean; checkpointStale: boolean } | null
}

export type DeclarationSheetEvent =
  | { type: 'collected'; checkpointId: string | null; creditedCount: number; claimsCount?: number }
  | { type: 'claimsAsserted'; assertedCount: number }
  | { type: 'skipClaims' }
  | { type: 'collectConflict' }
  | { type: 'collectRetry' }
  | { type: 'swept'; markedCount: number; sweepBatchId: string | null }
  // Skip pressed, or the exact preview resolved to 0 markable words.
  | { type: 'skipSweep' }
  | { type: 'undoFailed'; checkpointFailed: boolean; sweepFailed: boolean; checkpointStale: boolean }

export const initialDeclarationSheetState = ({
  checkpointIncluded,
  sweepIncluded,
  claimsCount = 0,
}: {
  checkpointIncluded: boolean
  sweepIncluded: boolean
  claimsCount?: number
}): DeclarationSheetState => ({
  // Callers only open the sheet when at least one step applies; a
  // checkpoint-less run starts on the claims step when it carries leftover
  // candidates, else directly on the sweep step.
  phase: checkpointIncluded ? 'checkpoint' : claimsCount > 0 ? 'claims' : 'sweep',
  checkpointIncluded,
  sweepIncluded,
  collectConflict: false,
  checkpoint: null,
  claimsCount,
  claims: null,
  sweep: null,
  undo: null,
})

const afterClaims = (state: DeclarationSheetState): DeclarationSheetPhase => (state.sweepIncluded ? 'sweep' : 'done')

export const reduceDeclarationSheet = (
  state: DeclarationSheetState,
  event: DeclarationSheetEvent
): DeclarationSheetState => {
  switch (event.type) {
    case 'collected':
      return {
        ...state,
        collectConflict: false,
        checkpoint: { checkpointId: event.checkpointId, creditedCount: event.creditedCount },
        claimsCount: event.claimsCount ?? 0,
        phase: (event.claimsCount ?? 0) > 0 ? 'claims' : afterClaims(state),
      }
    case 'claimsAsserted':
      return { ...state, claims: { assertedCount: event.assertedCount }, phase: afterClaims(state) }
    case 'skipClaims':
      return { ...state, phase: afterClaims(state) }
    case 'collectConflict':
      return { ...state, collectConflict: true }
    case 'collectRetry':
      return { ...state, collectConflict: false }
    case 'swept':
      return { ...state, sweep: { markedCount: event.markedCount, sweepBatchId: event.sweepBatchId }, phase: 'done' }
    case 'skipSweep':
      return { ...state, phase: 'done' }
    case 'undoFailed':
      return {
        ...state,
        phase: 'undoError',
        undo: {
          checkpointFailed: event.checkpointFailed,
          sweepFailed: event.sweepFailed,
          checkpointStale: event.checkpointStale,
        },
      }
  }
}

// "Step X of Y" kicker: only shown while an action step is on screen and the
// run actually has more than one.
export const declarationSheetStepIndicator = (
  state: DeclarationSheetState
): { current: number; total: number } | null => {
  const total = (state.checkpointIncluded ? 1 : 0) + (state.sweepIncluded ? 1 : 0)
  if (total < 2) return null
  if (state.phase === 'checkpoint') return { current: 1, total }
  if (state.phase === 'sweep') return { current: 2, total }
  return null
}

// Outcomes of the combined Undo (two independent endpoints, no shared
// transaction): full success closes the sheet; anything else must stay open
// and say what was NOT reverted. `checkpointStale` is the undone:false no-op —
// a newer checkpoint exists, so the credits legitimately stay.
export const reduceUndoOutcome = ({
  sweepAttempted,
  sweepOk,
  checkpointAttempted,
  checkpointOk,
  checkpointUndone,
}: {
  sweepAttempted: boolean
  sweepOk: boolean
  checkpointAttempted: boolean
  checkpointOk: boolean
  checkpointUndone: boolean
}): { fullSuccess: boolean; event: Extract<DeclarationSheetEvent, { type: 'undoFailed' }> | null } => {
  const sweepFailed = sweepAttempted && !sweepOk
  const checkpointFailed = checkpointAttempted && !checkpointOk
  const checkpointStale = checkpointAttempted && checkpointOk && !checkpointUndone
  if (!sweepFailed && !checkpointFailed && !checkpointStale) return { fullSuccess: true, event: null }
  return { fullSuccess: false, event: { type: 'undoFailed', checkpointFailed, sweepFailed, checkpointStale } }
}
