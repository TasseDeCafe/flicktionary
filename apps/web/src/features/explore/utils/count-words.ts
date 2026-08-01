// Word count for the detail screen's "~N words" stat. Intl.Segmenter's word
// granularity handles non-space-delimited scripts (zh/ja) where a whitespace
// split would return nonsense; isWordLike filters punctuation and whitespace.
export const countWords = (text: string, language: string): number => {
  try {
    const segmenter = new Intl.Segmenter(language, { granularity: 'word' })
    let count = 0
    for (const segment of segmenter.segment(text)) {
      if (segment.isWordLike) count += 1
    }
    return count
  } catch {
    // An invalid language tag throws in the constructor — fall back to a
    // whitespace split rather than showing no stat at all.
    return text.split(/\s+/).filter(Boolean).length
  }
}
