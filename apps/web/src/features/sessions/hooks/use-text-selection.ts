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

// Reads window.getSelection() and maps it to segment IDs + char offsets relative
// to each segment's text. Returns null if selection is empty or escapes the
// segment-id-tagged region.
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

  // The text container's first text-node child is the segment's text. The Range
  // offsets are character offsets into that text node when the container is the
  // text node itself, which is the case in segment-row.
  const startOffset = range.startOffset
  const endOffset = range.endOffset

  return {
    startSegmentId,
    endSegmentId,
    startOffset,
    endOffset,
    selectionText: text,
  }
}
