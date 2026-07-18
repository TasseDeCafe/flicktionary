import { getWordRanges } from '@flicktionary/core/dom/word-segmenter'
import { foldCheckpointToken } from '@flicktionary/core/utils/checkpoint-fold'

// Occurrence-preserving tokenizer for the track lemma profile. The checkpoint
// matcher's tokenizeSegments returns distinct-token Sets (right for matching,
// useless for counting), so this counting variant shares only the primitives —
// the same Intl.Segmenter word ranges and the same byte-pinned fold — and
// accumulates per-token occurrence counts instead. Coverage math needs real
// counts: a word appearing 50 times must weigh 50 tokens of mass.
export const countFoldedTokens = (
  segments: ReadonlyArray<{ text: string }>,
  targetLanguage: string,
  into?: Map<string, number>
): Map<string, number> => {
  const counts = into ?? new Map<string, number>()
  for (const segment of segments) {
    for (const [start, end] of getWordRanges(segment.text, targetLanguage)) {
      const folded = foldCheckpointToken(segment.text.slice(start, end), targetLanguage)
      if (!folded) continue
      counts.set(folded, (counts.get(folded) ?? 0) + 1)
    }
  }
  return counts
}
