import { describe, expect, test } from 'vitest'
import {
  buildStateArray,
  computeGridLayout,
  computeSkylineBuckets,
  hitTest,
  STATE_KNOWN,
  STATE_STUDIED,
  STATE_UNKNOWN,
} from './coverage-render'

describe('buildStateArray', () => {
  test('rank r lands at index r − 1, studied wins a shared rank', () => {
    const states = buildStateArray(5, [1, 3], [3, 5])
    expect(states[0]).toBe(STATE_STUDIED)
    expect(states[1]).toBe(STATE_UNKNOWN)
    expect(states[2]).toBe(STATE_STUDIED)
    expect(states[4]).toBe(STATE_KNOWN)
  })

  test('ranks past the denominator are clamped away', () => {
    const states = buildStateArray(3, [4], [99])
    expect([...states]).toEqual([STATE_UNKNOWN, STATE_UNKNOWN, STATE_UNKNOWN])
  })
})

describe('computeGridLayout', () => {
  test('columns fit the width, height accounts for the trailing gapless row', () => {
    // pitch 5 (cell 4 + gap 1); (98 + 1) / 5 → 19 columns.
    const layout = computeGridLayout({ count: 100, cssWidth: 98, cell: 4, gap: 1 })
    expect(layout.cols).toBe(19)
    expect(layout.rows).toBe(6)
    expect(layout.cssHeight).toBe(6 * 5 - 1)
  })

  test('never fewer than one column', () => {
    expect(computeGridLayout({ count: 10, cssWidth: 2, cell: 4, gap: 1 }).cols).toBe(1)
  })
})

describe('hitTest', () => {
  const layout = computeGridLayout({ count: 100, cssWidth: 98, cell: 4, gap: 1 })

  test('maps a pointer to the rank under it (row-major)', () => {
    // Second row (y in [5, 10)), third column → index 19 + 2 = 21 → rank 22.
    expect(hitTest({ x: 11, y: 6, layout, startRank: 1, count: 100 })).toBe(22)
  })

  test('respects a non-1 startRank (band waffles)', () => {
    expect(hitTest({ x: 0, y: 0, layout, startRank: 1001, count: 100 })).toBe(1001)
  })

  test('out of bounds is null', () => {
    expect(hitTest({ x: -1, y: 0, layout, startRank: 1, count: 100 })).toBeNull()
    expect(hitTest({ x: 200, y: 0, layout, startRank: 1, count: 100 })).toBeNull()
    // Past the last dot on the final partial row.
    expect(hitTest({ x: 60, y: 26, layout, startRank: 1, count: 100 })).toBeNull()
  })
})

describe('computeSkylineBuckets', () => {
  test('counts studied/known per bucket, partial tail bucket included', () => {
    const states = buildStateArray(5, [1, 2], [3])
    const buckets = computeSkylineBuckets(states, 2)
    expect(buckets).toEqual([
      { studied: 2, known: 0 },
      { studied: 0, known: 1 },
      { studied: 0, known: 0 },
    ])
  })
})
