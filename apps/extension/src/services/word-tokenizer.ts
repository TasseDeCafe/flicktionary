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
 * `locale` is the video's server-detected subtitle language, matching what the
 * web reader passes for the same text — Intl.Segmenter word rules are
 * locale-sensitive (apostrophes/hyphens), so a shared locale keeps word
 * boundaries (and therefore saved offsets) identical across platforms. `''`
 * (locale-less segmentation) is the fallback while the session — and with it
 * the detected language — is still unknown.
 */
export function tokenizeText(text: string, locale = ''): TokenizedWord[] {
  return wordRangesToTokens(text, getWordRanges(text, locale))
}
