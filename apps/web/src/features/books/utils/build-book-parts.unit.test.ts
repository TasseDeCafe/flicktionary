import { describe, expect, it } from 'vitest'
import {
  buildBookParts,
  hashBookParts,
  prepareChapters,
  splitLongParagraph,
  type BookChapter,
  type RawChapter,
} from './build-book-parts'

const untitled = (n: number) => `Section ${n}`
const fallback = (n: number) => `Part ${n}`

// n paragraphs of `size` chars each, uniquely numbered.
const paragraphs = (n: number, size: number, prefix = 'p'): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i} `.padEnd(size, 'x'))

const chapter = (title: string | null, paras: string[]): RawChapter => ({ title, paragraphs: paras })

describe('prepareChapters', () => {
  it('falls back from the TOC label to a heading-like first line to a numbered title', () => {
    const chapters = prepareChapters(
      [
        chapter('Глава 1', paragraphs(5, 400)),
        chapter(null, ['Глава 2', ...paragraphs(5, 400)]),
        chapter(null, paragraphs(5, 400)),
      ],
      untitled
    )
    expect(chapters.map((c) => c.title)).toEqual(['Глава 1', 'Глава 2', 'Section 3'])
  })

  it('pre-unchecks back matter and tiny sections', () => {
    const chapters = prepareChapters(
      [
        chapter('Тони Бучеру посвящается', ['Тони Бучеру посвящается']),
        chapter('Chapter 1', paragraphs(5, 400)),
        chapter('Notes', paragraphs(50, 400)),
        chapter('Примечания', paragraphs(5, 400)),
        chapter('Acknowledgments', paragraphs(5, 400)),
      ],
      untitled
    )
    expect(chapters.map((c) => c.includedByDefault)).toEqual([false, true, false, false, false])
  })

  it('drops empty chapters', () => {
    expect(prepareChapters([chapter('Empty', []), chapter('One', ['text'])], untitled)).toHaveLength(1)
  })
})

describe('splitLongParagraph', () => {
  it('keeps short paragraphs whole', () => {
    expect(splitLongParagraph('Short one.', 'en', 100)).toEqual(['Short one.'])
  })

  it('packs whole sentences under the cap', () => {
    const sentence = 'This is a sentence of forty chars long. '
    const pieces = splitLongParagraph(sentence.repeat(10).trim(), 'en', 100)
    expect(pieces.every((p) => p.length <= 100)).toBe(true)
    expect(pieces.join(' ')).toBe(sentence.repeat(10).trim())
  })

  it('falls back to words for an over-long sentence, then graphemes for a word', () => {
    const noPunctuation = 'слово '.repeat(60).trim()
    const byWords = splitLongParagraph(noPunctuation, 'ru', 50)
    expect(byWords.every((p) => p.length <= 50)).toBe(true)
    expect(byWords.join(' ')).toBe(noPunctuation)

    const oneWord = 'a'.repeat(120)
    expect(splitLongParagraph(oneWord, 'en', 50).map((p) => p.length)).toEqual([50, 50, 20])
  })
})

const prepared = (raw: RawChapter[]): BookChapter[] => prepareChapters(raw, untitled)

describe('buildBookParts', () => {
  it('keeps chapters under the split threshold whole, one part each', () => {
    const parts = buildBookParts({
      chapters: prepared([chapter('One', paragraphs(10, 1_000)), chapter('Two', paragraphs(20, 1_000))]),
      language: 'en',
      fallbackTitle: fallback,
    })
    expect(parts.map((p) => [p.partIndex, p.title, p.segments.length])).toEqual([
      [0, 'One', 10],
      [1, 'Two', 20],
    ])
  })

  it('splits an over-long chapter into near-equal parts at paragraph boundaries', () => {
    const parts = buildBookParts({
      chapters: prepared([chapter('Глава 12', paragraphs(50, 1_000)), chapter('Глава 13', paragraphs(5, 1_000))]),
      language: 'ru',
      fallbackTitle: fallback,
    })
    expect(parts.map((p) => p.title)).toEqual(['Глава 12 · 1/2', 'Глава 12 · 2/2', 'Глава 13'])
    expect(parts[0]!.segments).toHaveLength(25)
    expect(parts[1]!.segments).toHaveLength(25)
    expect([...parts[0]!.segments, ...parts[1]!.segments]).toEqual(paragraphs(50, 1_000))
  })

  it('cuts a book without chapters into ~20k numbered parts', () => {
    const parts = buildBookParts({
      chapters: prepared([chapter('The whole book', paragraphs(100, 1_000))]),
      language: 'en',
      fallbackTitle: fallback,
    })
    expect(parts.map((p) => p.title)).toEqual(['Part 1', 'Part 2', 'Part 3', 'Part 4', 'Part 5'])
    expect(parts.every((p) => p.segments.length === 20)).toBe(true)
  })

  it('caps every segment for the gloss context line', () => {
    const parts = buildBookParts({
      chapters: prepared([chapter('One', ['word '.repeat(1_000).trim()]), chapter('Two', ['x'])]),
      language: 'en',
      fallbackTitle: fallback,
    })
    expect(parts[0]!.segments.every((s) => s.length <= 1_500)).toBe(true)
  })

  it('hashes the imported text, so a different selection is a different book', () => {
    const chapters = prepared([chapter('One', ['a']), chapter('Two', ['b'])])
    const all = buildBookParts({ chapters, language: 'en', fallbackTitle: fallback })
    const firstOnly = buildBookParts({ chapters: chapters.slice(0, 1), language: 'en', fallbackTitle: fallback })
    expect(hashBookParts(all)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashBookParts(all)).not.toBe(hashBookParts(firstOnly))
  })
})
