import { describe, expect, test } from 'vitest'
import { buildWordHighlightSpans, type SegmentHighlightRange } from './segment-row.tsx'

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
      { text: 'cat', highlightId: null, word: [0, 3] },
      { text: ' ', highlightId: null, word: null },
      { text: 'dog', highlightId: null, word: [4, 7] },
    ])
  })

  test('word fully inside a highlight → one highlighted span with the word coords', () => {
    const ranges: SegmentHighlightRange[] = [{ highlightId: 'h1', start: 0, end: 3 }]
    const spans = buildWordHighlightSpans('cat', ranges, [[0, 3]])
    expect(spans).toEqual([{ text: 'cat', highlightId: 'h1', word: [0, 3] }])
  })

  test('word straddled by a highlight start/end → two adjacent spans sharing the word', () => {
    // Highlight covers "ca"; the word "cats" spans [0,4]. Both produced runs
    // carry the same word coords so a tap on either selects the whole word.
    const ranges: SegmentHighlightRange[] = [{ highlightId: 'h1', start: 0, end: 2 }]
    const spans = buildWordHighlightSpans('cats', ranges, [[0, 4]])
    expect(spans).toEqual([
      { text: 'ca', highlightId: 'h1', word: [0, 4] },
      { text: 'ts', highlightId: null, word: [0, 4] },
    ])
  })

  test('punctuation / whitespace between words → bare spans with no word attrs', () => {
    const spans = buildWordHighlightSpans('hi!', [], [[0, 2]])
    expect(spans).toEqual([
      { text: 'hi', highlightId: null, word: [0, 2] },
      { text: '!', highlightId: null, word: null },
    ])
  })

  test('empty text yields no spans', () => {
    expect(buildWordHighlightSpans('', [], [])).toEqual([])
  })
})
