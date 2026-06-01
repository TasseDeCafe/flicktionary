import { stripSrtMarkupWithMap } from '@flicktionary/core/utils/srt-markup'
import type { WordKey } from '@/lib/dom/use-word-selection'

export type SelectionResult = {
  startSegmentId: string
  endSegmentId: string
  startOffset: number
  endOffset: number
  selectionText: string
  // Display text of the segment the selection starts in — the sentence context
  // passed to the free preview gloss (glosses.fastGloss).
  contextLine: string
  // Snapshot of the selection's bounding box at the moment selection finished.
  // The floating sheet uses this to anchor itself on desktop; we capture here
  // because the painted selection clears once the sheet opens.
  rect: DOMRect
}

type SegmentLike = { id: string; text: string }

// The (segment, offset) part of a SelectionResult — everything but the rect,
// which the caller snapshots from the DOM.
export type NormalizedSelection = Pick<
  SelectionResult,
  'startSegmentId' | 'endSegmentId' | 'startOffset' | 'endOffset' | 'selectionText' | 'contextLine'
>

// Maps the gesture's two word endpoints to a persisted selection. The user can
// drag upward, so the end word may sit in a segment that appears *before* the
// anchor's segment in `segments`. Document order follows segment position (not
// offset value), so we index both owners into `segments` to decide which side
// supplies the start vs. end. Offsets stay in display-text coords (post
// stripSrtMarkupWithMap), matching what the rendered word spans carry.
//
// Returns null if either endpoint's owner segment isn't in `segments` (e.g.
// it scrolled out during a full-text-search filter change).
export const normalizeCrossSegmentSelection = (
  anchor: WordKey,
  end: WordKey,
  segments: readonly SegmentLike[]
): NormalizedSelection | null => {
  const indexById = new Map<string, number>()
  segments.forEach((s, i) => indexById.set(s.id, i))

  const anchorIdx = indexById.get(anchor.ownerKey)
  const endIdx = indexById.get(end.ownerKey)
  if (anchorIdx === undefined || endIdx === undefined) return null

  let startSegmentId: string
  let endSegmentId: string
  let startOffset: number
  let endOffset: number

  if (anchorIdx === endIdx) {
    // Same segment: span the union of both words.
    startSegmentId = anchor.ownerKey
    endSegmentId = anchor.ownerKey
    startOffset = Math.min(anchor.wordStart, end.wordStart)
    endOffset = Math.max(anchor.wordEnd, end.wordEnd)
  } else if (anchorIdx < endIdx) {
    startSegmentId = anchor.ownerKey
    startOffset = anchor.wordStart
    endSegmentId = end.ownerKey
    endOffset = end.wordEnd
  } else {
    startSegmentId = end.ownerKey
    startOffset = end.wordStart
    endSegmentId = anchor.ownerKey
    endOffset = anchor.wordEnd
  }

  // Build the selection text by walking the segment data in document order —
  // not from a DOM Range, which would leak each row's sibling timestamp span.
  const startIdx = indexById.get(startSegmentId)!
  const endSegIdx = indexById.get(endSegmentId)!
  const displayTextFor = (s: SegmentLike) => stripSrtMarkupWithMap(s.text).stripped

  const parts: string[] = []
  for (let i = startIdx; i <= endSegIdx; i++) {
    const display = displayTextFor(segments[i]!)
    if (i === startIdx && i === endSegIdx) parts.push(display.slice(startOffset, endOffset))
    else if (i === startIdx) parts.push(display.slice(startOffset))
    else if (i === endSegIdx) parts.push(display.slice(0, endOffset))
    else parts.push(display)
  }
  const selectionText = parts.join('\n').trim()

  // Sentence context for the stateless preview gloss: the full display text of
  // the segment the selection starts in (the model only needs the immediate
  // sentence, not the cross-segment span).
  const contextLine = displayTextFor(segments[startIdx]!)

  return { startSegmentId, endSegmentId, startOffset, endOffset, selectionText, contextLine }
}
