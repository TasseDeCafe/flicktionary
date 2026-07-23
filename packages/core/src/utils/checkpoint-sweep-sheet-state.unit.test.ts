import { describe, expect, it } from 'vitest'
import {
  declarationSheetStepIndicator,
  initialDeclarationSheetState,
  reduceDeclarationSheet,
  reduceUndoOutcome,
} from './checkpoint-sweep-sheet-state'

const fullRun = initialDeclarationSheetState({ checkpointIncluded: true, sweepIncluded: true })

describe('initialDeclarationSheetState', () => {
  it('starts on the checkpoint step when included', () => {
    expect(fullRun.phase).toBe('checkpoint')
  })

  it('starts directly on the sweep step for an already-reviewed span', () => {
    expect(initialDeclarationSheetState({ checkpointIncluded: false, sweepIncluded: true }).phase).toBe('sweep')
  })
})

describe('reduceDeclarationSheet', () => {
  it('advances checkpoint → sweep → done through the full run', () => {
    const collected = reduceDeclarationSheet(fullRun, {
      type: 'collected',
      checkpointId: 'cp-1',
      creditedCount: 3,
    })
    expect(collected.phase).toBe('sweep')
    expect(collected.checkpoint).toEqual({ checkpointId: 'cp-1', creditedCount: 3 })
    const swept = reduceDeclarationSheet(collected, { type: 'swept', markedCount: 460, sweepBatchId: 'batch-1' })
    expect(swept.phase).toBe('done')
    expect(swept.sweep).toEqual({ markedCount: 460, sweepBatchId: 'batch-1' })
  })

  it('skips straight to done for a checkpoint-only run', () => {
    const checkpointOnly = initialDeclarationSheetState({ checkpointIncluded: true, sweepIncluded: false })
    const collected = reduceDeclarationSheet(checkpointOnly, {
      type: 'collected',
      checkpointId: 'cp-1',
      creditedCount: 0,
    })
    expect(collected.phase).toBe('done')
  })

  it('Skip (or a 0-count preview) ends the run without a sweep result', () => {
    const collected = reduceDeclarationSheet(fullRun, { type: 'collected', checkpointId: 'cp-1', creditedCount: 3 })
    const skipped = reduceDeclarationSheet(collected, { type: 'skipSweep' })
    expect(skipped.phase).toBe('done')
    expect(skipped.sweep).toBeNull()
  })

  it('a collect conflict stays on the checkpoint step until retried', () => {
    const conflicted = reduceDeclarationSheet(fullRun, { type: 'collectConflict' })
    expect(conflicted.phase).toBe('checkpoint')
    expect(conflicted.collectConflict).toBe(true)
    const retried = reduceDeclarationSheet(conflicted, { type: 'collectRetry' })
    expect(retried.collectConflict).toBe(false)
    expect(retried.phase).toBe('checkpoint')
  })

  it('a failed undo lands on undoError with the per-part outcome', () => {
    const collected = reduceDeclarationSheet(fullRun, { type: 'collected', checkpointId: 'cp-1', creditedCount: 3 })
    const swept = reduceDeclarationSheet(collected, { type: 'swept', markedCount: 460, sweepBatchId: 'batch-1' })
    const failed = reduceDeclarationSheet(swept, {
      type: 'undoFailed',
      checkpointFailed: true,
      sweepFailed: false,
      checkpointStale: false,
    })
    expect(failed.phase).toBe('undoError')
    expect(failed.undo).toEqual({ checkpointFailed: true, sweepFailed: false, checkpointStale: false })
  })
})

describe('declarationSheetStepIndicator', () => {
  it('numbers both action steps of a full run', () => {
    expect(declarationSheetStepIndicator(fullRun)).toEqual({ current: 1, total: 2 })
    const collected = reduceDeclarationSheet(fullRun, { type: 'collected', checkpointId: 'cp-1', creditedCount: 3 })
    expect(declarationSheetStepIndicator(collected)).toEqual({ current: 2, total: 2 })
  })

  it('hides for single-step runs and on the done screen', () => {
    expect(
      declarationSheetStepIndicator(initialDeclarationSheetState({ checkpointIncluded: true, sweepIncluded: false }))
    ).toBeNull()
    const collected = reduceDeclarationSheet(fullRun, { type: 'collected', checkpointId: 'cp-1', creditedCount: 3 })
    const swept = reduceDeclarationSheet(collected, { type: 'swept', markedCount: 1, sweepBatchId: null })
    expect(declarationSheetStepIndicator(swept)).toBeNull()
  })
})

describe('reduceUndoOutcome', () => {
  it('reports full success when everything attempted reverted', () => {
    expect(
      reduceUndoOutcome({
        sweepAttempted: true,
        sweepOk: true,
        checkpointAttempted: true,
        checkpointOk: true,
        checkpointUndone: true,
      })
    ).toEqual({ fullSuccess: true, event: null })
  })

  it('treats undone:false as a stale checkpoint, not a network failure', () => {
    const { fullSuccess, event } = reduceUndoOutcome({
      sweepAttempted: true,
      sweepOk: true,
      checkpointAttempted: true,
      checkpointOk: true,
      checkpointUndone: false,
    })
    expect(fullSuccess).toBe(false)
    expect(event).toEqual({ type: 'undoFailed', checkpointFailed: false, sweepFailed: false, checkpointStale: true })
  })

  it('reports each failed part independently', () => {
    const { event } = reduceUndoOutcome({
      sweepAttempted: true,
      sweepOk: false,
      checkpointAttempted: true,
      checkpointOk: false,
      checkpointUndone: false,
    })
    expect(event).toEqual({ type: 'undoFailed', checkpointFailed: true, sweepFailed: true, checkpointStale: false })
  })

  it('ignores parts that never ran (sweep skipped)', () => {
    expect(
      reduceUndoOutcome({
        sweepAttempted: false,
        sweepOk: false,
        checkpointAttempted: true,
        checkpointOk: true,
        checkpointUndone: true,
      })
    ).toEqual({ fullSuccess: true, event: null })
  })
})
