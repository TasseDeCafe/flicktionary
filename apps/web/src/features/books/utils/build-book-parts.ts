import { sha256 } from 'js-sha256'
import { BOOK_SEGMENT_MAX_CHARS } from '@flicktionary/api-client/orpc-contracts/books-contract'

// A chapter as extracted from the file, before the user picks what to import.
export type RawChapter = {
  title: string | null
  paragraphs: string[]
}

export type BookChapter = {
  id: number
  title: string
  paragraphs: string[]
  charCount: number
  // Pre-checked in the chapter picker: back matter and tiny sections
  // (title pages, dedications, epigraphs) start unchecked.
  includedByDefault: boolean
}

export type BookPartDraft = {
  partIndex: number
  title: string
  segments: string[]
}

// A chapter above this is split into near-equal parts at paragraph
// boundaries — a part is one reading session, kept article-sized.
export const PART_SPLIT_THRESHOLD_CHARS = 30_000
// Books without usable chapters are cut into parts of about this size.
export const FALLBACK_PART_CHARS = 20_000
const MIN_DEFAULT_CHAPTER_CHARS = 1_000
const MAX_HEADING_TITLE_CHARS = 80

const BACK_MATTER_TITLE =
  /^(notes?|footnotes|endnotes|copyright|contents|table of contents|bibliography|selected bibliography.*|references|further reading|acknowledge?ments?|about the authors?|index|other (books|titles).*|also by.*|books by.*|cover|title page|примечания|комментарии|сноски|содержание|оглавление|библиография|благодарности|об авторе|от издательства|anmerkungen|inhalt|inhaltsverzeichnis|danksagung|impressum|über (den|die) autor(in)?|table des matières|remerciements|à propos de l'auteur|notas|índice|agradecimientos|sobre el autor|sumário|agradecimentos|sobre o autor)$/i

const charCountOf = (paragraphs: readonly string[]): number => paragraphs.reduce((sum, p) => sum + p.length, 0)

export const prepareChapters = (
  raw: readonly RawChapter[],
  untitledTitle: (position: number) => string
): BookChapter[] =>
  raw
    .filter((chapter) => chapter.paragraphs.length > 0)
    .map((chapter, id) => {
      // Title fallback: TOC label, else a heading-like first line, else "Section N".
      const firstLine = chapter.paragraphs[0]!
      const title =
        chapter.title?.trim() || (firstLine.length <= MAX_HEADING_TITLE_CHARS ? firstLine : '') || untitledTitle(id + 1)
      const charCount = charCountOf(chapter.paragraphs)
      const isBackMatter = BACK_MATTER_TITLE.test(title.replace(/[.:]+$/, '').trim())
      return {
        id,
        title,
        paragraphs: chapter.paragraphs,
        charCount,
        includedByDefault: !isBackMatter && charCount >= MIN_DEFAULT_CHAPTER_CHARS,
      }
    })

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// Greedy packing of pieces into chunks of at most `max` chars; `join` goes
// between pieces that share a chunk.
const packPieces = (pieces: readonly string[], max: number, join: string): string[] => {
  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    const candidate = current ? current + join + piece : piece
    if (candidate.length <= max) {
      current = candidate
      continue
    }
    if (current) chunks.push(current)
    current = piece
  }
  if (current) chunks.push(current)
  return chunks
}

const splitByGraphemes = (text: string, max: number): string[] =>
  packPieces(
    Array.from(graphemeSegmenter.segment(text), (s) => s.segment),
    max,
    ''
  )

const splitByWords = (text: string, max: number): string[] =>
  text
    .split(/(?<=\s)/)
    .flatMap((word) => (word.length > max ? splitByGraphemes(word, max) : [word]))
    .reduce<string[]>((chunks, word) => {
      const last = chunks[chunks.length - 1]
      if (last !== undefined && (last + word).length <= max) chunks[chunks.length - 1] = last + word
      else chunks.push(word)
      return chunks
    }, [])
    .map((chunk) => chunk.trim())
    .filter(Boolean)

// The reader sends a whole segment as the gloss context line, so every
// segment must fit the cap: sentences first, then words, then graphemes.
export const splitLongParagraph = (
  paragraph: string,
  language: string | null,
  max = BOOK_SEGMENT_MAX_CHARS
): string[] => {
  if (paragraph.length <= max) return [paragraph]
  const sentenceSegmenter = new Intl.Segmenter(language ?? undefined, { granularity: 'sentence' })
  const sentences = Array.from(sentenceSegmenter.segment(paragraph), (s) => s.segment.trim()).filter(Boolean)
  const pieces = sentences.flatMap((sentence) => (sentence.length > max ? splitByWords(sentence, max) : [sentence]))
  return packPieces(pieces, max, ' ')
}

// Splits paragraphs into `count` runs of near-equal char length, never inside a
// paragraph.
const splitIntoRuns = (paragraphs: readonly string[], count: number): string[][] => {
  if (count <= 1) return [[...paragraphs]]
  const target = charCountOf(paragraphs) / count
  const runs: string[][] = [[]]
  let runChars = 0
  for (const paragraph of paragraphs) {
    const run = runs[runs.length - 1]!
    const boundaryReached = runChars >= target * runs.length
    if (run.length > 0 && boundaryReached && runs.length < count) runs.push([paragraph])
    else run.push(paragraph)
    runChars += paragraph.length
  }
  return runs
}

export const buildBookParts = (params: {
  chapters: readonly BookChapter[]
  language: string | null
  fallbackTitle: (position: number) => string
}): BookPartDraft[] => {
  const { chapters, language } = params
  const drafts: { title: string; paragraphs: string[] }[] = []
  // A book with a single chapter has no usable structure: cut it into
  // evenly-sized numbered parts.
  if (chapters.length === 1) {
    const only = chapters[0]!
    const count = Math.max(1, Math.round(only.charCount / FALLBACK_PART_CHARS))
    splitIntoRuns(only.paragraphs, count).forEach((paragraphs, i) =>
      drafts.push({ title: count === 1 ? only.title : params.fallbackTitle(i + 1), paragraphs })
    )
  } else {
    for (const chapter of chapters) {
      const count = Math.ceil(chapter.charCount / PART_SPLIT_THRESHOLD_CHARS)
      const runs = splitIntoRuns(chapter.paragraphs, count)
      runs.forEach((paragraphs, i) =>
        drafts.push({
          title: runs.length === 1 ? chapter.title : `${chapter.title} · ${i + 1}/${runs.length}`,
          paragraphs,
        })
      )
    }
  }
  return drafts
    .map((draft) => ({
      title: draft.title,
      segments: draft.paragraphs.flatMap((paragraph) => splitLongParagraph(paragraph, language)),
    }))
    .filter((draft) => draft.segments.length > 0)
    .map((draft, partIndex) => ({ partIndex, ...draft }))
}

// Per-user dedup key for a book: the normalized text the user actually
// imported, so the same file with a different chapter selection is a
// different book. The server stores and compares it, never recomputes it.
export const hashBookParts = (parts: readonly BookPartDraft[]): string =>
  sha256(parts.map((part) => part.segments.join('\n')).join('\n\n'))
