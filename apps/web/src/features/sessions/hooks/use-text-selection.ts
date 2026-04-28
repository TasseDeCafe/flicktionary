export type SelectionResult = {
  startSegmentId: string
  endSegmentId: string
  startOffset: number
  endOffset: number
  selectionText: string
}

const findSegmentAncestor = (node: Node | null): HTMLElement | null => {
  let cur: Element | null = node instanceof Element ? node : (node?.parentElement ?? null)
  while (cur && !(cur instanceof HTMLElement && cur.dataset.segmentId)) {
    cur = cur.parentElement
  }
  return cur as HTMLElement | null
}

// Segment text may be split across multiple span children (so existing
// highlights can paint partial ranges), so range.startOffset is relative to
// whichever text node the boundary lands in. To get the offset relative to the
// whole segment, count the characters from the segment root up to the
// boundary using a temporary Range.
const offsetWithinSegment = (segmentEl: HTMLElement, container: Node, offsetInContainer: number): number => {
  const r = document.createRange()
  r.selectNodeContents(segmentEl)
  r.setEnd(container, offsetInContainer)
  return r.toString().length
}

export const readCurrentSelection = (): SelectionResult | null => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const text = sel.toString().trim()
  if (!text) return null
  const range = sel.getRangeAt(0)

  const startEl = findSegmentAncestor(range.startContainer)
  const endEl = findSegmentAncestor(range.endContainer)
  if (!startEl || !endEl) return null

  const startSegmentId = startEl.dataset.segmentId!
  const endSegmentId = endEl.dataset.segmentId!

  const startOffset = offsetWithinSegment(startEl, range.startContainer, range.startOffset)
  const endOffset = offsetWithinSegment(endEl, range.endContainer, range.endOffset)

  return {
    startSegmentId,
    endSegmentId,
    startOffset,
    endOffset,
    selectionText: text,
  }
}
