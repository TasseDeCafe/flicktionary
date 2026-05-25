import type { SegmentGhostRange, SegmentHighlightRange } from './word-highlight-spans'

type Segment = {
  id: string
  text: string
}

type Highlight = {
  id: string
  startSegmentId: string
  endSegmentId: string
  startOffset: number
  endOffset: number
}

// For each highlight, walk the (ordered) visible-segments slice and emit
// per-segment ranges. Highlights that span multiple lines paint:
//   start segment: [startOffset, segment.text.length]
//   middle segments: [0, segment.text.length]
//   end segment:   [0, endOffset]
// Single-line highlights collapse to [startOffset, endOffset].
// Highlights whose start or end segment isn't present in the visible slice
// (e.g. during full-text-search filtering) still paint whatever segments do
// match — it's a partial render, not a logic error.
export const buildSegmentRanges = (
  highlights: readonly Highlight[],
  segments: readonly Segment[]
): Map<string, SegmentHighlightRange[]> => {
  const out = new Map<string, SegmentHighlightRange[]>()
  if (highlights.length === 0 || segments.length === 0) return out

  const indexById = new Map<string, number>()
  segments.forEach((s, i) => indexById.set(s.id, i))

  const push = (segmentId: string, range: SegmentHighlightRange) => {
    const arr = out.get(segmentId)
    if (arr) arr.push(range)
    else out.set(segmentId, [range])
  }

  for (const h of highlights) {
    if (h.startSegmentId === h.endSegmentId) {
      push(h.startSegmentId, { highlightId: h.id, start: h.startOffset, end: h.endOffset })
      continue
    }
    const startIdx = indexById.get(h.startSegmentId)
    const endIdx = indexById.get(h.endSegmentId)
    if (startIdx !== undefined) {
      const startSeg = segments[startIdx]!
      push(startSeg.id, { highlightId: h.id, start: h.startOffset, end: startSeg.text.length })
    }
    if (endIdx !== undefined) {
      const endSeg = segments[endIdx]!
      push(endSeg.id, { highlightId: h.id, start: 0, end: h.endOffset })
    }
    if (startIdx !== undefined && endIdx !== undefined && endIdx > startIdx + 1) {
      for (let i = startIdx + 1; i < endIdx; i++) {
        const mid = segments[i]!
        push(mid.id, { highlightId: h.id, start: 0, end: mid.text.length })
      }
    }
  }
  return out
}

type GhostCandidate = {
  id: string
  segmentId: string
  charStart: number
  charEnd: number
}

// Ghosts are always single-segment (a nominated span never straddles a segment
// boundary), so this is a straight group-by-segment of [charStart, charEnd) ranges.
// Offsets are in the same display-text coords as highlights (segment text is stored
// already SRT-stripped), so segment-row's strip-map remap applies identically.
export const buildGhostSegmentRanges = (ghosts: readonly GhostCandidate[]): Map<string, SegmentGhostRange[]> => {
  const out = new Map<string, SegmentGhostRange[]>()
  for (const g of ghosts) {
    const range: SegmentGhostRange = { ghostId: g.id, start: g.charStart, end: g.charEnd }
    const arr = out.get(g.segmentId)
    if (arr) arr.push(range)
    else out.set(g.segmentId, [range])
  }
  return out
}
