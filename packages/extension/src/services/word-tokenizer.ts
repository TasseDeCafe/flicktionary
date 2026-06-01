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
