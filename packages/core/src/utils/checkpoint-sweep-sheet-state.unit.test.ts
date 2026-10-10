import { describe, expect, it } from 'vitest'
import { initialDeclarationSheetState, reduceDeclarationSheet } from './checkpoint-sweep-sheet-state'

const fullRun = initialDeclarationSheetState({ checkpointIncluded: true, sweepIncluded: true })

describe('initialDeclarationSheetState', () => {
  it('starts on the checkpoint step when included', () => {
    expect(fullRun.phase).toBe('checkpoint')
  })

  it('starts directly on the sweep step for an already-reviewed span', () => {
    expect(initialDeclarationSheetState({ checkpointIncluded: false, sweepIncluded: true }).phase).toBe('sweep')
  })
})

describe('the claims step', () => {
  it('follows the collect when it returned candidates, then continues to the sweep', () => {
    const collected = reduceDeclarationSheet(fullRun, {
      type: 'collected',
      checkpointId: 'cp-1',
      creditedCount: 2,
      claimsCount: 4,
    })
    expect(collected.phase).toBe('claims')
    const asserted = reduceDeclarationSheet(collected, { type: 'claimsAsserted', assertedCount: 3 })
    expect(asserted.phase).toBe('sweep')
    expect(asserted.claims).toEqual({ assertedCount: 3 })
  })

  it('is skippable, and ends a run with no sweep', () => {
    const checkpointOnly = initialDeclarationSheetState({ checkpointIncluded: true, sweepIncluded: false })
    const collected = reduceDeclarationSheet(checkpointOnly, {
      type: 'collected',
      checkpointId: 'cp-1',
      creditedCount: 0,
      claimsCount: 1,
    })
    const skipped = reduceDeclarationSheet(collected, { type: 'skipClaims' })
    expect(skipped.phase).toBe('done')
    expect(skipped.claims).toBeNull()
  })

  it('opens a re-entry run that only carries leftover candidates', () => {
    const reentry = initialDeclarationSheetState({ checkpointIncluded: false, sweepIncluded: false, claimsCount: 5 })
    expect(reentry.phase).toBe('claims')
    expect(reduceDeclarationSheet(reentry, { type: 'claimsAsserted', assertedCount: 5 }).phase).toBe('done')
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
})
