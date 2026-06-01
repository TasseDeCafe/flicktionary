// Thin wrapper around `Intl.Segmenter` used by the tap-to-select-word gesture.
// Both the session view and the practice view tokenize their plain text into
// word ranges so a single pointer-down resolves to exactly one word, with
// CJK / Thai handled correctly by the built-in word segmenter (no extra deps).

// A half-open `[start, end)` range into the source string, in code-unit
// (string index) coordinates — matching how the rendered DOM and persisted
// offsets already address text elsewhere.
export type WordRange = [start: number, end: number]

// The `Intl.Segmenter` constructor is non-trivial; reuse one per locale.
const segmenterCache = new Map<string, Intl.Segmenter>()

const getSegmenter = (locale: string): Intl.Segmenter => {
  const cached = segmenterCache.get(locale)
  if (cached) return cached
  // Fall back to the default locale if the supplied tag is somehow invalid —
  // segmentation still works, just without locale-specific word rules.
  let segmenter: Intl.Segmenter
  try {
    segmenter = new Intl.Segmenter(locale, { granularity: 'word' })
  } catch {
    segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  }
  segmenterCache.set(locale, segmenter)
  return segmenter
}

// Segment bodies repeat across re-renders (the same subtitle line / paragraph
// is tokenized again on every paint), so memoize `(text, locale) → ranges`.
const LRU_LIMIT = 256
const rangesCache = new Map<string, WordRange[]>()

// NUL separator for the `(locale, text)` cache key — it cannot occur in a
// BCP-47 locale tag, so the two fields can never run together ambiguously.
const KEY_SEPARATOR = String.fromCharCode(0)

// Returns the `isWordLike` ranges only — punctuation and whitespace segments
// are excluded, so a pointer-down over them is a no-op in the caller.
export const getWordRanges = (text: string, locale: string): WordRange[] => {
  const key = `${locale}${KEY_SEPARATOR}${text}`
  const cached = rangesCache.get(key)
  if (cached) {
    // Refresh recency: delete + re-insert moves the key to the end.
    rangesCache.delete(key)
    rangesCache.set(key, cached)
    return cached
  }

  const ranges: WordRange[] = []
  if (text.length > 0) {
    for (const seg of getSegmenter(locale).segment(text)) {
      if (seg.isWordLike) ranges.push([seg.index, seg.index + seg.segment.length])
    }
  }

  rangesCache.set(key, ranges)
  if (rangesCache.size > LRU_LIMIT) {
    // Evict the least-recently-used entry (first key in insertion order).
    const oldest = rangesCache.keys().next().value
    if (oldest !== undefined) rangesCache.delete(oldest)
  }
  return ranges
}
