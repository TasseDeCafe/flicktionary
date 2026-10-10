import type { DeclarationResult } from './declaration-preview'

// The three independent undo endpoints. None of them may reject — failures
// come back as `false` / `ok: false`.
export type DeclarationUndoOps = {
  undoSweep: (sweepBatchId: string) => Promise<boolean>
  undoAssertions: (checkpointId: string) => Promise<boolean>
  undoCheckpoint: (checkpointId: string) => Promise<{ ok: boolean; undone: boolean }>
}

// The combined Undo: sweep, then the known-assertions, then the checkpoint
// (assertions hang off the checkpoint, so they go first). The endpoints share
// no transaction, so every part is attempted and reported separately:
// `remaining` carries only what is still un-reverted (null on full success).
// `checkpointStale` is the checkpoint undo's `undone: false` no-op — a newer
// checkpoint exists, so the credits legitimately stay; not a failure.
export const runDeclarationUndo = async (
  result: DeclarationResult,
  ops: DeclarationUndoOps
): Promise<{ remaining: DeclarationResult | null; checkpointStale: boolean }> => {
  const sweepBatchId = result.sweep?.sweepBatchId ?? null
  const sweepFailed = sweepBatchId != null && !(await ops.undoSweep(sweepBatchId))

  const asserted = result.claims && result.claims.assertedCount > 0 ? result.claims : null
  const assertionsFailed = asserted != null && !(await ops.undoAssertions(asserted.checkpointId))

  const checkpointId = result.checkpoint?.checkpointId ?? null
  let checkpointFailed = false
  let checkpointStale = false
  if (checkpointId != null) {
    const outcome = await ops.undoCheckpoint(checkpointId)
    checkpointFailed = !outcome.ok
    checkpointStale = outcome.ok && !outcome.undone
  }

  if (!sweepFailed && !assertionsFailed && !checkpointFailed) {
    return { remaining: null, checkpointStale }
  }
  return {
    remaining: {
      checkpoint: checkpointFailed ? result.checkpoint : null,
      claims: assertionsFailed ? result.claims : null,
      sweep: sweepFailed ? result.sweep : null,
    },
    checkpointStale,
  }
}
