/**
 * Word tokenizer for subtitle text.
 *
 * Segmentation is delegated to the shared `Intl.Segmenter` utility in
 * `@flicktionary/core` — the same code the web app uses — so word boundaries
 * are identical across surfaces and Unicode-correct for every language
 * (German umlauts, Portuguese diacritics, Korean Hangul, CJK, Thai, …). The
 * previous Latin+Cyrillic-only regex split `painéis` into `pain`/`é`/`is` and
 * matched no Hangul at all.
 */
import { getWordRanges, type WordRange } from '@flicktionary/core/dom/word-segmenter'

export interface TokenizedWord {
  text: string
  isWord: boolean // true if it's a word, false if it's punctuation/whitespace
}

/**
 * Converts the word-only ranges from `getWordRanges` into the contiguous
 * `TokenizedWord[]` stream this module's consumers expect, filling the gaps
 * between words with `isWord: false` segments.
 *
 * The result is contiguous and covers all of `[0, text.length)` — an invariant
 * the save path relies on, since clicked-word char offsets are derived by
 * walking this stream.
 */
function wordRangesToTokens(text: string, ranges: WordRange[]): TokenizedWord[] {
  const tokens: TokenizedWord[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) tokens.push({ text: text.slice(cursor, start), isWord: false })
    tokens.push({ text: text.slice(start, end), isWord: true })
    cursor = end
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor), isWord: false })
  return tokens
}

/**
 * Tokenizes text into words and non-word segments (punctuation, spaces, etc.)
 *
 * Locale-less segmentation (`''`) is sufficient for the languages we support —
 * Unicode word-break and ICU dictionary breaking don't need the locale tag for
 * German/Portuguese/Korean/CJK/Thai.
 */
export function tokenizeText(text: string): TokenizedWord[] {
  return wordRangesToTokens(text, getWordRanges(text, ''))
}

/**
 * Wraps each word in a span element with data attributes for interaction.
 * Non-word segments are preserved as-is.
 *
 * When `subtitleIndex` is provided, each word also carries
 * `data-segment-index` and `data-char-start`/`data-char-end` so the Flicktionary
 * save path can resolve the clicked occurrence back to a `text_segments` row +
 * exact char offsets — `indexOf` over the segment text picks the wrong instance
 * for repeated words like "и" / "я".
 */
export function tokenizeToHtml(text: string, sentenceText: string, subtitleIndex?: number): string {
  const tokens = tokenizeText(text)
  const hasSegmentIndex = typeof subtitleIndex === 'number' && Number.isFinite(subtitleIndex)
  const escapedSentence = escapeHtml(sentenceText)
  let cursor = 0

  return tokens
    .map((token) => {
      const tokenLength = token.text.length
      const charStart = cursor
      const charEnd = cursor + tokenLength
      cursor = charEnd

      if (!token.isWord) {
        return escapeHtml(token.text)
      }

      const escapedWord = escapeHtml(token.text)
      const segmentAttrs = hasSegmentIndex
        ? ` data-segment-index="${subtitleIndex}" data-char-start="${charStart}" data-char-end="${charEnd}"`
        : ''
      return `<span class="asbplayer-word" data-word="${escapedWord}" data-sentence="${escapedSentence}"${segmentAttrs}>${escapedWord}</span>`
    })
    .join('')
}

/**
 * Escapes HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
