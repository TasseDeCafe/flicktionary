import { describe, expect, test } from 'vitest'
import { buildSegmentRanges } from './build-segment-ranges'

type Highlight = Parameters<typeof buildSegmentRanges>[0][number]

const highlight = (over: Partial<Highlight>): Highlight => ({
  id: 'h1',
  startSegmentId: 'seg-1',
  endSegmentId: 'seg-1',
  startOffset: 3,
  endOffset: 9,
  ...over,
})

const segments = [
  { id: 'seg-1', text: 'alpha beta gamma' }, // length 16
  { id: 'seg-2', text: 'delta epsilon' }, // length 13
  { id: 'seg-3', text: 'zeta eta' }, // length 8
]

describe('buildSegmentRanges', () => {
  test('collapses a single-segment highlight to [startOffset, endOffset]', () => {
    const out = buildSegmentRanges([highlight({})], segments)
    expect(out.get('seg-1')).toEqual([{ highlightId: 'h1', start: 3, end: 9 }])
    expect(out.size).toBe(1)
  })

  test('emits a phantom entry for a single-segment highlight whose id is not in the slice', () => {
    const out = buildSegmentRanges([highlight({ startSegmentId: 'ghost', endSegmentId: 'ghost' })], segments)
    expect(out.get('ghost')).toEqual([{ highlightId: 'h1', start: 3, end: 9 }])
  })

  test('paints a cross-segment highlight per segment: start tail, whole middles, end head', () => {
    const h = highlight({ startSegmentId: 'seg-1', endSegmentId: 'seg-3', startOffset: 6, endOffset: 4 })
    const out = buildSegmentRanges([h], segments)
    expect(out.get('seg-1')).toEqual([{ highlightId: 'h1', start: 6, end: 16 }])
    expect(out.get('seg-2')).toEqual([{ highlightId: 'h1', start: 0, end: 13 }])
    expect(out.get('seg-3')).toEqual([{ highlightId: 'h1', start: 0, end: 4 }])
  })

  test('adjacent start/end segments get no middle entries', () => {
    const h = highlight({ startSegmentId: 'seg-1', endSegmentId: 'seg-2', startOffset: 6, endOffset: 4 })
    const out = buildSegmentRanges([h], segments)
    expect(out.get('seg-1')).toEqual([{ highlightId: 'h1', start: 6, end: 16 }])
    expect(out.get('seg-2')).toEqual([{ highlightId: 'h1', start: 0, end: 4 }])
    expect(out.size).toBe(2)
  })

  test('missing end segment paints only the start tail, no middles', () => {
    const h = highlight({ startSegmentId: 'seg-1', endSegmentId: 'missing', startOffset: 6, endOffset: 4 })
    const out = buildSegmentRanges([h], segments)
    expect(out.get('seg-1')).toEqual([{ highlightId: 'h1', start: 6, end: 16 }])
    expect(out.size).toBe(1)
  })

  test('missing start segment paints only the end head, no middles', () => {
    const h = highlight({ startSegmentId: 'missing', endSegmentId: 'seg-3', startOffset: 6, endOffset: 4 })
    const out = buildSegmentRanges([h], segments)
    expect(out.get('seg-3')).toEqual([{ highlightId: 'h1', start: 0, end: 4 }])
    expect(out.size).toBe(1)
  })

  test('does not clamp: over-length and inverted offsets pass through verbatim', () => {
    const over = highlight({ id: 'over', startOffset: 3, endOffset: 50 })
    const inverted = highlight({ id: 'inv', startOffset: 12, endOffset: 5 })
    const out = buildSegmentRanges([over, inverted], segments)
    expect(out.get('seg-1')).toEqual([
      { highlightId: 'over', start: 3, end: 50 },
      { highlightId: 'inv', start: 12, end: 5 },
    ])
  })

  test('overlapping highlights emit ranges in highlights order', () => {
    const a = highlight({ id: 'a', startOffset: 0, endOffset: 8 })
    const b = highlight({ id: 'b', startOffset: 4, endOffset: 12 })
    const out = buildSegmentRanges([a, b], segments)
    expect(out.get('seg-1')!.map((r) => r.highlightId)).toEqual(['a', 'b'])
  })

  test('returns an empty map for empty highlights or empty segments', () => {
    expect(buildSegmentRanges([], segments).size).toBe(0)
    expect(buildSegmentRanges([highlight({})], []).size).toBe(0)
  })
})
