import { describe, expect, test } from 'vitest'
import { normalizeCrossSegmentSelection } from './selection-adapter.ts'
import type { WordKey } from '@/lib/dom/use-word-selection'

const segments = [
  { id: 'A', text: 'alpha beta' },
  { id: 'B', text: 'gamma delta' },
]
// Offsets within each segment:
//   A: alpha [0,5]  beta [6,10]
//   B: gamma [0,5]  delta [6,11]

const word = (ownerKey: string, wordStart: number, wordEnd: number): WordKey => ({ ownerKey, wordStart, wordEnd })

describe('normalizeCrossSegmentSelection', () => {
  test('upward drag (anchor in B, end in A) normalizes to document order', () => {
    const anchor = word('B', 0, 5) // gamma
    const end = word('A', 6, 10) // beta
    const result = normalizeCrossSegmentSelection(anchor, end, segments)
    expect(result).toEqual({
      startSegmentId: 'A',
      endSegmentId: 'B',
      startOffset: 6, // A's end-word (beta) start
      endOffset: 5, // B's anchor-word (gamma) end
      selectionText: 'beta\ngamma',
      contextLine: 'alpha beta', // display text of the start segment (A)
    })
  })

  test('forward drag (anchor in A, end in B)', () => {
    const anchor = word('A', 0, 5) // alpha
    const end = word('B', 6, 11) // delta
    const result = normalizeCrossSegmentSelection(anchor, end, segments)
    expect(result).toEqual({
      startSegmentId: 'A',
      endSegmentId: 'B',
      startOffset: 0,
      endOffset: 11,
      selectionText: 'alpha beta\ngamma delta',
      contextLine: 'alpha beta', // display text of the start segment (A)
    })
  })

  test('single-segment selection spans the union of both words', () => {
    const anchor = word('A', 0, 5) // alpha
    const end = word('A', 6, 10) // beta
    const result = normalizeCrossSegmentSelection(anchor, end, segments)
    expect(result).toEqual({
      startSegmentId: 'A',
      endSegmentId: 'A',
      startOffset: 0,
      endOffset: 10,
      selectionText: 'alpha beta',
      contextLine: 'alpha beta', // display text of the start segment (A)
    })
  })

  test('single-segment selection is order-independent', () => {
    const forward = normalizeCrossSegmentSelection(word('A', 0, 5), word('A', 6, 10), segments)
    const reverse = normalizeCrossSegmentSelection(word('A', 6, 10), word('A', 0, 5), segments)
    expect(reverse).toEqual(forward)
  })

  test('single-word tap (anchor === end) selects just that word', () => {
    const result = normalizeCrossSegmentSelection(word('A', 6, 10), word('A', 6, 10), segments)
    expect(result).toEqual({
      startSegmentId: 'A',
      endSegmentId: 'A',
      startOffset: 6,
      endOffset: 10,
      selectionText: 'beta',
      contextLine: 'alpha beta', // display text of the start segment (A)
    })
  })

  test('returns null when an endpoint owner is not in the visible segments', () => {
    const result = normalizeCrossSegmentSelection(word('A', 0, 5), word('GONE', 0, 5), segments)
    expect(result).toBeNull()
  })
})
