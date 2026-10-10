// State machine for the merged declaration sheet
// (checkpoint → claims → sweep → done).
// Kept pure so the step-inclusion matrix and the transition rules are
// unit-testable without mounting the overlay. The component dispatches
// events; async work (mutations, the exact span preview) stays in the
// component. `done` has no screen: reaching it ends the run, and the host
// app confirms what was written (with its Undo) outside the sheet.

export type DeclarationSheetPhase = 'checkpoint' | 'claims' | 'sweep' | 'done'

export type DeclarationSheetState = {
  phase: DeclarationSheetPhase
  // Which action steps this run includes (fixed at open; the sweep step can
  // still be skipped later if its exact count resolves to 0).
  checkpointIncluded: boolean
  sweepIncluded: boolean
  checkpoint: { checkpointId: string | null; creditedCount: number } | null
  // The claims step ("saved but never practiced"): `claimsCount` is how many
  // candidates the run has to offer — known at open for a claims re-entry,
  // otherwise only once the collect returns them. 0 means no claims step.
  claimsCount: number
  claims: { assertedCount: number } | null
  sweep: { markedCount: number; sweepBatchId: string | null } | null
}

export type DeclarationSheetEvent =
  | { type: 'collected'; checkpointId: string | null; creditedCount: number; claimsCount?: number }
  | { type: 'claimsAsserted'; assertedCount: number }
  | { type: 'skipClaims' }
  | { type: 'swept'; markedCount: number; sweepBatchId: string | null }
  // Skip pressed, or the exact preview resolved to 0 markable words.
  | { type: 'skipSweep' }

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
  checkpoint: null,
  claimsCount,
  claims: null,
  sweep: null,
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
        checkpoint: { checkpointId: event.checkpointId, creditedCount: event.creditedCount },
        claimsCount: event.claimsCount ?? 0,
        phase: (event.claimsCount ?? 0) > 0 ? 'claims' : afterClaims(state),
      }
    case 'claimsAsserted':
      return { ...state, claims: { assertedCount: event.assertedCount }, phase: afterClaims(state) }
    case 'skipClaims':
      return { ...state, phase: afterClaims(state) }
    case 'swept':
      return { ...state, sweep: { markedCount: event.markedCount, sweepBatchId: event.sweepBatchId }, phase: 'done' }
    case 'skipSweep':
      return { ...state, phase: 'done' }
  }
}
