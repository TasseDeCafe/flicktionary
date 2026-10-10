// Store slice + pure derivations for the over-video declaration sheet. Kept
// out of the component file so the exact-count rule stays unit-testable
// without the UI dependencies.

import type { CheckpointCandidate } from '@flicktionary/ui/components/candidate-checklist'

export type DeclarationPreview =
  | { status: 'loading' }
  | {
      status: 'ready'
      // The due saved words the collect would credit. Null when the list
      // failed to load — the sheet then collects without one.
      reviewCandidates: CheckpointCandidate[] | null
      markKnownStatus: 'ready' | 'pending' | 'failed' | 'unsupported'
      markableLemmaCount: number
    }

export type DeclarationState = {
  // Bumped per open — remounts the sheet so each run initializes fresh state.
  runKey: number
  // Frontier snapshot captured at tap; patched in place (never remounted) by
  // a conflict re-snapshot.
  segmentIndex: number
  // Set once the first preview resolves and kept through re-snapshots, so the
  // sweep/undo commands stay usable even when a refreshed preview fails.
  sessionId?: string
  preview: DeclarationPreview
}

// The sweep step promises exactly what the mutation will insert. A non-ready
// profile (pending/failed/unsupported — transport failures fold into 'failed')
// resolves to 0 so the shared reducer's auto-skip removes the step; a
// still-loading preview stays null (Mark button disabled, "Counting words…").
export const declarationExactCount = (preview: DeclarationPreview): number | null => {
  if (preview.status !== 'ready') {
    return null
  }
  return preview.markKnownStatus === 'ready' ? preview.markableLemmaCount : 0
}

// What a finished run wrote. A null part was skipped or not reached.
export type DeclarationResult = {
  // A null id is an empty-span collect: nothing was saved.
  checkpoint: { checkpointId: string | null; creditedCount: number } | null
  claims: { checkpointId: string; assertedCount: number } | null
  sweep: { markedCount: number; sweepBatchId: string | null } | null
}
