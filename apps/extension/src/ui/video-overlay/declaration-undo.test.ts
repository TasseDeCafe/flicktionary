import { describe, expect, it, vi } from 'vitest'
import { runDeclarationUndo, type DeclarationUndoOps } from './declaration-undo'
import type { DeclarationResult } from './declaration-preview'

const fullResult: DeclarationResult = {
  checkpoint: { checkpointId: 'cp-1', creditedCount: 3 },
  claims: { checkpointId: 'cp-1', assertedCount: 2 },
  sweep: { markedCount: 120, sweepBatchId: 'batch-1' },
}

const opsWith = (overrides: Partial<DeclarationUndoOps> = {}): DeclarationUndoOps => ({
  undoSweep: vi.fn(async () => true),
  undoAssertions: vi.fn(async () => true),
  undoCheckpoint: vi.fn(async () => ({ ok: true, undone: true })),
  ...overrides,
})

describe('runDeclarationUndo', () => {
  it('reverts sweep, then assertions, then the checkpoint', async () => {
    const order: string[] = []
    const ops = opsWith({
      undoSweep: async () => (order.push('sweep'), true),
      undoAssertions: async () => (order.push('assertions'), true),
      undoCheckpoint: async () => (order.push('checkpoint'), { ok: true, undone: true }),
    })
    expect(await runDeclarationUndo(fullResult, ops)).toEqual({ remaining: null, checkpointStale: false })
    expect(order).toEqual(['sweep', 'assertions', 'checkpoint'])
  })

  it('keeps only the failed parts for a retry, and still attempts the others', async () => {
    const ops = opsWith({ undoAssertions: vi.fn(async () => false) })
    expect(await runDeclarationUndo(fullResult, ops)).toEqual({
      remaining: { checkpoint: null, claims: fullResult.claims, sweep: null },
      checkpointStale: false,
    })
    expect(ops.undoCheckpoint).toHaveBeenCalledWith('cp-1')
  })

  it('treats undone:false as a stale checkpoint, not a failure', async () => {
    const ops = opsWith({ undoCheckpoint: vi.fn(async () => ({ ok: true, undone: false })) })
    expect(await runDeclarationUndo(fullResult, ops)).toEqual({ remaining: null, checkpointStale: true })
  })

  it('skips parts the run never wrote', async () => {
    const ops = opsWith()
    await runDeclarationUndo(
      {
        checkpoint: { checkpointId: null, creditedCount: 0 },
        claims: { checkpointId: 'cp-1', assertedCount: 0 },
        sweep: { markedCount: 5, sweepBatchId: null },
      },
      ops
    )
    expect(ops.undoSweep).not.toHaveBeenCalled()
    expect(ops.undoAssertions).not.toHaveBeenCalled()
    expect(ops.undoCheckpoint).not.toHaveBeenCalled()
  })
})
