import { describe, expect, test } from 'vitest'
import type { GhostCandidate } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { findOverlappingGhost } from './ghost-overlap'

const ghost = (over: Partial<GhostCandidate>): GhostCandidate => ({
  id: 'g',
  studySessionId: 's',
  segmentId: 'seg-1',
  charStart: 0,
  charEnd: 4,
  surfaceForm: 'word',
  ...over,
})

const segments = [{ id: 'seg-1', text: 'alpha beta gamma' }]

describe('findOverlappingGhost', () => {
  test('returns null when no ghost shares characters with the selection', () => {
    const sel = { startSegmentId: 'seg-1', endSegmentId: 'seg-1', startOffset: 0, endOffset: 5 }
    const ghosts = [ghost({ id: 'g1', charStart: 11, charEnd: 16 })] // "gamma"
    expect(findOverlappingGhost(sel, ghosts, segments)).toBeNull()
  })

  test('returns the ghost whose span overlaps the selection', () => {
    const sel = { startSegmentId: 'seg-1', endSegmentId: 'seg-1', startOffset: 6, endOffset: 10 } // "beta"
    const ghosts = [ghost({ id: 'g1', charStart: 6, charEnd: 12 })] // overlaps "beta", extends past
    expect(findOverlappingGhost(sel, ghosts, segments)?.id).toBe('g1')
  })

  test('picks the ghost with the most overlap, tie-broken by the smallest ghost', () => {
    const sel = { startSegmentId: 'seg-1', endSegmentId: 'seg-1', startOffset: 0, endOffset: 10 } // "alpha beta"
    const ghosts = [
      ghost({ id: 'big', charStart: 0, charEnd: 12 }), // overlap clipped to 10
      ghost({ id: 'small', charStart: 0, charEnd: 5 }), // overlap 5
    ]
    // "big" has more overlap.
    expect(findOverlappingGhost(sel, ghosts, segments)?.id).toBe('big')

    const equalOverlap = [
      ghost({ id: 'wide', charStart: 0, charEnd: 16 }), // overlap clipped to selection = 10
      ghost({ id: 'tight', charStart: 0, charEnd: 12 }), // overlap 10, smaller width
    ]
    expect(findOverlappingGhost(sel, equalOverlap, segments)?.id).toBe('tight')
  })

  test('suppresses a ghost the selection matches exactly (nothing to switch to)', () => {
    const sel = { startSegmentId: 'seg-1', endSegmentId: 'seg-1', startOffset: 6, endOffset: 10 }
    const ghosts = [ghost({ id: 'exact', charStart: 6, charEnd: 10 })]
    expect(findOverlappingGhost(sel, ghosts, segments)).toBeNull()
  })

  test('still suggests a ghost that overlaps but differs from the selection', () => {
    const sel = { startSegmentId: 'seg-1', endSegmentId: 'seg-1', startOffset: 6, endOffset: 10 } // "beta"
    const ghosts = [ghost({ id: 'wider', charStart: 6, charEnd: 16 })] // "beta gamma"
    expect(findOverlappingGhost(sel, ghosts, segments)?.id).toBe('wider')
  })

  test('ignores ghosts in a different segment', () => {
    const sel = { startSegmentId: 'seg-1', endSegmentId: 'seg-1', startOffset: 0, endOffset: 5 }
    const ghosts = [ghost({ id: 'other', segmentId: 'seg-2', charStart: 0, charEnd: 5 })]
    expect(findOverlappingGhost(sel, ghosts, segments)).toBeNull()
  })
})
