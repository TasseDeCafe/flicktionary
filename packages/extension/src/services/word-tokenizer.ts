/**
 * Simple word tokenizer for Russian text.
 * Splits text on whitespace and punctuation while preserving the original structure.
 */

export interface TokenizedWord {
  text: string
  isWord: boolean // true if it's a word, false if it's punctuation/whitespace
}

// Pattern for splitting Russian/Cyrillic text into words and non-words
// Matches: letters (including Cyrillic), apostrophes within words, hyphens within words
const WORD_PATTERN = /([а-яА-ЯёЁa-zA-Z]+(?:[-'][а-яА-ЯёЁa-zA-Z]+)*)/g

/**
 * Tokenizes text into words and non-word segments (punctuation, spaces, etc.)
 */
export function tokenizeText(text: string): TokenizedWord[] {
  const tokens: TokenizedWord[] = []
  let lastIndex = 0

  // Use matchAll to find all words
  const matches = text.matchAll(WORD_PATTERN)

  for (const match of matches) {
    const matchIndex = match.index!
    const matchText = match[0]

    // Add any non-word content before this match
    if (matchIndex > lastIndex) {
      const nonWord = text.slice(lastIndex, matchIndex)
      tokens.push({ text: nonWord, isWord: false })
    }

    // Add the word
    tokens.push({ text: matchText, isWord: true })
    lastIndex = matchIndex + matchText.length
  }

  // Add any remaining non-word content after the last match
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), isWord: false })
  }

  return tokens
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
