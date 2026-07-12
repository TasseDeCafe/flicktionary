import { describe, expect, it } from 'vitest'
import { buildSentencePieces, selectionOverlapsRanges, type SentencePiece } from './sentence-pieces'

// "She filled the bucket with water."
//  0123456789...
const TEXT = 'She filled the bucket with water.'
const WORDS: Array<[number, number]> = [
  [0, 3], // She
  [4, 10], // filled
  [11, 14], // the
  [15, 21], // bucket
  [22, 26], // with
  [27, 32], // water
]

const visibleText = (pieces: SentencePiece[]) => pieces.map((p) => (p.kind === 'blank' ? '______' : p.text)).join('')

describe('buildSentencePieces', () => {
  it('reconstructs the visible text from words and filler', () => {
    const pieces = buildSentencePieces({ text: TEXT, wordRanges: WORDS })
    expect(visibleText(pieces)).toBe(TEXT)
    expect(pieces.filter((p) => p.kind === 'word')).toHaveLength(WORDS.length)
  })

  it('replaces the blank span with a single blank piece and drops its text', () => {
    const pieces = buildSentencePieces({ text: TEXT, wordRanges: WORDS, blank: { start: 15, end: 21 } })
    expect(pieces.filter((p) => p.kind === 'blank')).toHaveLength(1)
    // The hidden answer never renders.
    expect(visibleText(pieces)).not.toContain('bucket')
    expect(visibleText(pieces)).toBe('She filled the ______ with water.')
  })

  it('preserves original-string offsets on both sides of the blank', () => {
    const pieces = buildSentencePieces({ text: TEXT, wordRanges: WORDS, blank: { start: 15, end: 21 } })
    const words = pieces.filter((p): p is Extract<SentencePiece, { kind: 'word' }> => p.kind === 'word')
    expect(words.map((w) => [w.start, w.end])).toEqual([
      [0, 3],
      [4, 10],
      [11, 14],
      [22, 26],
      [27, 32],
    ])
    expect(TEXT.slice(words[3]!.start, words[3]!.end)).toBe('with')
  })

  it('renders words intersecting a blocked range as plain (offset-less selectable-wise) pieces', () => {
    const pieces = buildSentencePieces({ text: TEXT, wordRanges: WORDS, blockedRanges: [{ start: 15, end: 21 }] })
    // Text is intact (blocked ≠ blanked)…
    expect(visibleText(pieces)).toBe(TEXT)
    // …but "bucket" is no longer a word piece.
    const words = pieces.filter((p) => p.kind === 'word').map((p) => (p as { text: string }).text)
    expect(words).not.toContain('bucket')
    expect(words).toContain('with')
  })

  it('blocks a word the range only partially covers', () => {
    // Range covering just "buck" still de-words the whole of "bucket".
    const pieces = buildSentencePieces({ text: TEXT, wordRanges: WORDS, blockedRanges: [{ start: 15, end: 19 }] })
    const words = pieces.filter((p) => p.kind === 'word').map((p) => (p as { text: string }).text)
    expect(words).not.toContain('bucket')
    expect(visibleText(pieces)).toBe(TEXT)
  })

  it('handles a blank at the start and end of the sentence', () => {
    const startBlank = buildSentencePieces({ text: TEXT, wordRanges: WORDS, blank: { start: 0, end: 3 } })
    expect(visibleText(startBlank)).toBe('______ filled the bucket with water.')
    const endBlank = buildSentencePieces({ text: TEXT, wordRanges: WORDS, blank: { start: 27, end: 32 } })
    expect(visibleText(endBlank)).toBe('She filled the bucket with ______.')
  })
})

describe('selectionOverlapsRanges', () => {
  const ranges = [{ start: 15, end: 21 }]

  it('rejects a selection strictly inside the range', () => {
    expect(selectionOverlapsRanges({ charStart: 16, charEnd: 20 }, ranges)).toBe(true)
  })

  it('rejects a selection sweeping across the range', () => {
    expect(selectionOverlapsRanges({ charStart: 4, charEnd: 26 }, ranges)).toBe(true)
  })

  it('allows a selection ending exactly at the range start ([start,end) semantics)', () => {
    expect(selectionOverlapsRanges({ charStart: 11, charEnd: 15 }, ranges)).toBe(false)
  })

  it('allows a selection starting exactly at the range end', () => {
    expect(selectionOverlapsRanges({ charStart: 21, charEnd: 26 }, ranges)).toBe(false)
  })

  it('allows anything when there are no ranges', () => {
    expect(selectionOverlapsRanges({ charStart: 0, charEnd: 33 }, [])).toBe(false)
  })
})
