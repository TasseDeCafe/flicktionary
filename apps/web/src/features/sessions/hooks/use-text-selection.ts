import { findMarkedAncestor, offsetWithinAncestor } from '@/lib/dom/text-selection'

export type SelectionResult = {
  startSegmentId: string
  endSegmentId: string
  startOffset: number
  endOffset: number
  selectionText: string
}

const isSegmentMarker = (el: HTMLElement) => !!el.dataset.segmentId

// Segment text may be split across multiple span children (so existing
// highlights can paint partial ranges); we use a Range-based offset
// calculation so the per-segment offset stays correct regardless of how the
// segment's contents are split.
export const readCurrentSelection = (): SelectionResult | null => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const text = sel.toString().trim()
  if (!text) return null
  const range = sel.getRangeAt(0)

  const startEl = findMarkedAncestor(range.startContainer, isSegmentMarker)
  const endEl = findMarkedAncestor(range.endContainer, isSegmentMarker)
  if (!startEl || !endEl) return null

  const startSegmentId = startEl.dataset.segmentId!
  const endSegmentId = endEl.dataset.segmentId!

  const startOffset = offsetWithinAncestor(startEl, range.startContainer, range.startOffset)
  const endOffset = offsetWithinAncestor(endEl, range.endContainer, range.endOffset)

  return {
    startSegmentId,
    endSegmentId,
    startOffset,
    endOffset,
    selectionText: text,
  }
}
