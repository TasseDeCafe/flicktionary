export type SegmentHighlightRange = {
  highlightId: string
  start: number
  end: number
}

// A passive LLM-nominated span in a segment (Phase 2 ghost candidate), in the same
// display-text coordinate space as SegmentHighlightRange.
export type SegmentGhostRange = {
  ghostId: string
  start: number
  end: number
}

// A rendered run of text, tagged with the highlight it belongs to (if any), the
// ghost candidate it overlaps (if any), and the enclosing word's offsets (if any).
// A run carries `word` when it is part of a word-like segment, so a tap anywhere in
// it selects the whole word, even when a highlight/ghost boundary splits one word
// into adjacent runs that share the same `word`.
export type WordHighlightSpan = {
  text: string
  highlightId: string | null
  // The ghost candidate covering this run, or null. A committed highlight takes
  // visual precedence (the caller renders the fill, not the outline, where both
  // overlap), but the ghost id is still carried so adoption can find it.
  ghostId: string | null
  // [start, end) of the enclosing word in display-text coords, or null for
  // whitespace / punctuation (which is not selectable).
  word: [number, number] | null
}

// Splits `displayText` at the union of highlight boundaries, ghost boundaries, and
// word boundaries, so each produced run lies entirely within at most one highlight,
// at most one ghost, and at most one word. Consecutive characters that share the
// same (highlightId, ghostId, word) collapse into a single run. Overlapping ranges
// of the same kind collapse to the last id (last write wins).
export const buildWordHighlightSpans = (
  displayText: string,
  ranges: SegmentHighlightRange[],
  wordRanges: ReadonlyArray<readonly [number, number]>,
  ghostRanges: ReadonlyArray<SegmentGhostRange> = []
): WordHighlightSpan[] => {
  const len = displayText.length
  if (len === 0) return []

  const marks: (string | null)[] = new Array(len).fill(null)
  for (const r of ranges) {
    const s = Math.max(0, Math.min(len, r.start))
    const e = Math.max(0, Math.min(len, r.end))
    for (let i = s; i < e; i++) marks[i] = r.highlightId
  }

  const ghostMarks: (string | null)[] = new Array(len).fill(null)
  for (const g of ghostRanges) {
    const s = Math.max(0, Math.min(len, g.start))
    const e = Math.max(0, Math.min(len, g.end))
    for (let i = s; i < e; i++) ghostMarks[i] = g.ghostId
  }

  // Per-character word index (-1 = not part of a word). Segmenter ranges are
  // disjoint, so a character belongs to at most one word.
  const wordIdx: number[] = new Array(len).fill(-1)
  wordRanges.forEach(([s, e], idx) => {
    const lo = Math.max(0, Math.min(len, s))
    const hi = Math.max(0, Math.min(len, e))
    for (let i = lo; i < hi; i++) wordIdx[i] = idx
  })

  const spans: WordHighlightSpan[] = []
  let i = 0
  while (i < len) {
    const curMark = marks[i]
    const curGhost = ghostMarks[i]
    const curWord = wordIdx[i]
    let j = i + 1
    while (j < len && marks[j] === curMark && ghostMarks[j] === curGhost && wordIdx[j] === curWord) j++
    spans.push({
      text: displayText.slice(i, j),
      highlightId: curMark,
      ghostId: curGhost,
      word: curWord >= 0 ? [wordRanges[curWord]![0], wordRanges[curWord]![1]] : null,
    })
    i = j
  }
  return spans
}
