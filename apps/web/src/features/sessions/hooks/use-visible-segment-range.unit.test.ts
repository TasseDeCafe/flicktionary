import { describe, expect, it } from 'vitest'
import { computeVisibleRange } from './use-visible-segment-range'

const indexMap = (entries: Record<string, number>) => new Map(Object.entries(entries))

describe('computeVisibleRange', () => {
  it('returns nulls when nothing is visible', () => {
    expect(computeVisibleRange([], indexMap({ a: 0, b: 1 }))).toEqual({
      shallowestIndex: null,
      deepestIndex: null,
    })
  })

  it('reports the min and max indices among the visible ids', () => {
    const range = computeVisibleRange(['c', 'a', 'b'], indexMap({ a: 4, b: 12, c: 7 }))
    expect(range).toEqual({ shallowestIndex: 4, deepestIndex: 12 })
  })

  it('collapses to a single index when one segment is visible', () => {
    expect(computeVisibleRange(['a'], indexMap({ a: 3 }))).toEqual({ shallowestIndex: 3, deepestIndex: 3 })
  })

  it('ignores ids with no index mapping', () => {
    const range = computeVisibleRange(['ghost', 'a', 'other'], indexMap({ a: 5 }))
    expect(range).toEqual({ shallowestIndex: 5, deepestIndex: 5 })
  })

  it('returns nulls when no visible id maps to an index', () => {
    expect(computeVisibleRange(['x', 'y'], indexMap({ a: 1 }))).toEqual({
      shallowestIndex: null,
      deepestIndex: null,
    })
  })

  it('handles index 0 as a real value, not a falsy miss', () => {
    expect(computeVisibleRange(['a'], indexMap({ a: 0 }))).toEqual({ shallowestIndex: 0, deepestIndex: 0 })
  })
})
