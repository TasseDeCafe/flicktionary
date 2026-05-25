import { describe, expect, test } from 'vitest'
import {
  buildWordHighlightSpans,
  type SegmentGhostRange,
  type SegmentHighlightRange,
} from '../utils/word-highlight-spans.ts'

describe('buildWordHighlightSpans', () => {
  test('word with no highlight overlap → one span carrying the word coords', () => {
    const spans = buildWordHighlightSpans(
      'cat dog',
      [],
      [
        [0, 3],
        [4, 7],
      ]
    )
    expect(spans).toEqual([
      { text: 'cat', highlightId: null, ghostId: null, word: [0, 3] },
      { text: ' ', highlightId: null, ghostId: null, word: null },
      { text: 'dog', highlightId: null, ghostId: null, word: [4, 7] },
    ])
  })

  test('word fully inside a highlight → one highlighted span with the word coords', () => {
    const ranges: SegmentHighlightRange[] = [{ highlightId: 'h1', start: 0, end: 3 }]
    const spans = buildWordHighlightSpans('cat', ranges, [[0, 3]])
    expect(spans).toEqual([{ text: 'cat', highlightId: 'h1', ghostId: null, word: [0, 3] }])
  })

  test('word straddled by a highlight start/end → two adjacent spans sharing the word', () => {
    // Highlight covers "ca"; the word "cats" spans [0,4]. Both produced runs
    // carry the same word coords so a tap on either selects the whole word.
    const ranges: SegmentHighlightRange[] = [{ highlightId: 'h1', start: 0, end: 2 }]
    const spans = buildWordHighlightSpans('cats', ranges, [[0, 4]])
    expect(spans).toEqual([
      { text: 'ca', highlightId: 'h1', ghostId: null, word: [0, 4] },
      { text: 'ts', highlightId: null, ghostId: null, word: [0, 4] },
    ])
  })

  test('punctuation / whitespace between words → bare spans with no word attrs', () => {
    const spans = buildWordHighlightSpans('hi!', [], [[0, 2]])
    expect(spans).toEqual([
      { text: 'hi', highlightId: null, ghostId: null, word: [0, 2] },
      { text: '!', highlightId: null, ghostId: null, word: null },
    ])
  })

  test('empty text yields no spans', () => {
    expect(buildWordHighlightSpans('', [], [])).toEqual([])
  })

  test('word inside a ghost (no highlight) → run carries the ghost id', () => {
    const ghosts: SegmentGhostRange[] = [{ ghostId: 'g1', start: 0, end: 3 }]
    const spans = buildWordHighlightSpans(
      'cat dog',
      [],
      [
        [0, 3],
        [4, 7],
      ],
      ghosts
    )
    expect(spans).toEqual([
      { text: 'cat', highlightId: null, ghostId: 'g1', word: [0, 3] },
      { text: ' ', highlightId: null, ghostId: null, word: null },
      { text: 'dog', highlightId: null, ghostId: null, word: [4, 7] },
    ])
  })

  test('highlight and ghost overlapping the same word → run carries both ids', () => {
    // The caller renders the highlight fill (not the ghost outline) where both
    // overlap, but the ghost id rides along so adoption can still resolve it.
    const ranges: SegmentHighlightRange[] = [{ highlightId: 'h1', start: 0, end: 3 }]
    const ghosts: SegmentGhostRange[] = [{ ghostId: 'g1', start: 0, end: 3 }]
    const spans = buildWordHighlightSpans('cat', ranges, [[0, 3]], ghosts)
    expect(spans).toEqual([{ text: 'cat', highlightId: 'h1', ghostId: 'g1', word: [0, 3] }])
  })
})
