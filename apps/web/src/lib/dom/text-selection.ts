// DOM-selection primitives shared by features that translate a Window
// `Range` into application-level offsets. The session view uses these to
// resolve a selection to (segmentId, startOffset, endOffset); the practice
// view uses them to resolve a selection to body-relative (charStart, charEnd).

// Walk from a node up to the nearest ancestor that satisfies `isMarker`. The
// caller decides what counts as a marker (e.g. `el.dataset.segmentId` or
// `el.dataset.kind === 'plain'`).
export const findMarkedAncestor = (node: Node | null, isMarker: (el: HTMLElement) => boolean): HTMLElement | null => {
  let cur: Element | null = node instanceof Element ? node : (node?.parentElement ?? null)
  while (cur && !(cur instanceof HTMLElement && isMarker(cur))) {
    cur = cur.parentElement
  }
  return cur as HTMLElement | null
}

// Number of characters between the start of `ancestorEl` and the (container,
// offsetInContainer) boundary. Uses a Range to walk the DOM so it works even
// when the ancestor's contents are split across multiple text nodes (which
// happens when existing highlights paint partial ranges over a segment).
export const offsetWithinAncestor = (ancestorEl: HTMLElement, container: Node, offsetInContainer: number): number => {
  const r = document.createRange()
  r.selectNodeContents(ancestorEl)
  r.setEnd(container, offsetInContainer)
  return r.toString().length
}
