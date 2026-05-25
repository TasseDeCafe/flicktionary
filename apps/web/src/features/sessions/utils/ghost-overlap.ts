import type { GhostCandidate } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { buildSegmentRanges } from './build-segment-ranges'

type SelectionLike = {
  startSegmentId: string
  endSegmentId: string
  startOffset: number
  endOffset: number
}

type Segment = { id: string; text: string }

// Find the ghost the user's committed selection overlaps, if any. "Overlap" = the
// selection and the ghost share at least one character (and therefore ≥1 word, since
// selections snap to whole words) in the same segment. The selection is decomposed
// into per-segment ranges via the same machinery highlights use, so a multi-segment
// selection is handled correctly. On multiple matches we pick the most word-overlap,
// tie-broken by the smallest ghost (the tightest containing suggestion).
export const findOverlappingGhost = (
  selection: SelectionLike,
  ghosts: readonly GhostCandidate[],
  segments: readonly Segment[]
): GhostCandidate | null => {
  if (ghosts.length === 0) return null
  // Reuse buildSegmentRanges with a synthetic highlight to get the selection's
  // per-segment [start, end) ranges (handles single- and multi-segment spans).
  const selRanges = buildSegmentRanges(
    [
      {
        id: '__sel__',
        startSegmentId: selection.startSegmentId,
        endSegmentId: selection.endSegmentId,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
      },
    ],
    segments
  )

  const isSingleSegment = selection.startSegmentId === selection.endSegmentId

  let best: GhostCandidate | null = null
  let bestOverlap = 0
  for (const ghost of ghosts) {
    // Exact match — the user already selected precisely the ghost's span, so there
    // is nothing to "switch" to. Suppress the suggestion rather than offer a no-op.
    if (
      isSingleSegment &&
      ghost.segmentId === selection.startSegmentId &&
      ghost.charStart === selection.startOffset &&
      ghost.charEnd === selection.endOffset
    ) {
      continue
    }
    const ranges = selRanges.get(ghost.segmentId)
    if (!ranges) continue
    for (const r of ranges) {
      const overlap = Math.min(r.end, ghost.charEnd) - Math.max(r.start, ghost.charStart)
      if (overlap <= 0) continue
      const ghostWidth = ghost.charEnd - ghost.charStart
      const bestWidth = best ? best.charEnd - best.charStart : Number.POSITIVE_INFINITY
      if (overlap > bestOverlap || (overlap === bestOverlap && ghostWidth < bestWidth)) {
        best = ghost
        bestOverlap = overlap
      }
    }
  }
  return best
}
