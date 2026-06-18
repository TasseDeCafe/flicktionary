// Paint saved highlights and the transient selection on a live article page via
// the CSS Custom Highlight API — paint only, never wrapping or mutating the
// article body DOM (the one host-page touch is a single injected `<style>`). The
// painter owns the `Highlight` registry entries and the geometry hit-test that
// reopens a saved span on click (CSS highlights are paint, not DOM, so there is
// no event target to click).
//
// Targets: Chrome 105+ (our min is 116) and Firefox 140+ (June 2025) — the API
// is assumed present. Colors mirror the web reader's SAVED/SELECTION washes.

const STYLE_ATTR = 'data-flicktionary-article-highlight-style'
const SAVED_NAME = 'flicktionary-article-saved'
const SELECTION_NAME = 'flicktionary-article-selection'

const STYLE_TEXT = `::highlight(${SAVED_NAME}){background-color:rgba(250,204,21,0.35);}
::highlight(${SELECTION_NAME}){background-color:rgba(56,189,248,0.30);}`

// `caretPositionFromPoint` (Firefox/standard) / `caretRangeFromPoint` (Chrome)
// aren't both in every lib.dom; resolve a point to a `(node, offset)` caret
// across engines.
interface CaretPoint {
  node: Node
  offset: number
}

const caretFromPoint = (doc: Document, x: number, y: number): CaretPoint | null => {
  const withCaretPosition = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (typeof withCaretPosition.caretPositionFromPoint === 'function') {
    const pos = withCaretPosition.caretPositionFromPoint(x, y)
    if (pos) return { node: pos.offsetNode, offset: pos.offset }
  }
  const withCaretRange = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (typeof withCaretRange.caretRangeFromPoint === 'function') {
    const range = withCaretRange.caretRangeFromPoint(x, y)
    if (range) return { node: range.startContainer, offset: range.startOffset }
  }
  return null
}

export interface HighlightPainter {
  // The transient sky selection wash (null clears it).
  setSelection(range: Range | null): void
  // Replace the full set of saved yellow spans.
  setSaved(entries: ReadonlyArray<{ id: string; range: Range }>): void
  addSaved(id: string, range: Range): void
  removeSaved(id: string): void
  // The saved highlight id painted under the viewport point, or null.
  hitTest(x: number, y: number): string | null
  // Clear every painted range + the registry entries (toggle off).
  clear(): void
  // Full teardown: clear + remove the injected style.
  destroy(): void
}

export const createHighlightPainter = (doc: Document): HighlightPainter => {
  if (!doc.querySelector(`[${STYLE_ATTR}]`)) {
    const style = doc.createElement('style')
    style.setAttribute(STYLE_ATTR, '')
    style.textContent = STYLE_TEXT
    doc.head.appendChild(style)
  }

  const saved = new Map<string, Range>()
  let selection: Range | null = null

  const repaintSaved = () => {
    const ranges = Array.from(saved.values())
    if (ranges.length === 0) {
      CSS.highlights.delete(SAVED_NAME)
      return
    }
    CSS.highlights.set(SAVED_NAME, new Highlight(...ranges))
  }

  const repaintSelection = () => {
    if (!selection) {
      CSS.highlights.delete(SELECTION_NAME)
      return
    }
    CSS.highlights.set(SELECTION_NAME, new Highlight(selection))
  }

  return {
    setSelection(range) {
      selection = range
      repaintSelection()
    },
    setSaved(entries) {
      saved.clear()
      for (const { id, range } of entries) saved.set(id, range)
      repaintSaved()
    },
    addSaved(id, range) {
      saved.set(id, range)
      repaintSaved()
    },
    removeSaved(id) {
      saved.delete(id)
      repaintSaved()
    },
    hitTest(x, y) {
      const caret = caretFromPoint(doc, x, y)
      if (!caret) return null
      for (const [id, range] of saved) {
        try {
          if (range.isPointInRange(caret.node, caret.offset)) return id
        } catch {
          // The caret node isn't comparable to this range (different subtree) —
          // skip; another saved range may still contain it.
        }
      }
      return null
    },
    clear() {
      saved.clear()
      selection = null
      CSS.highlights.delete(SAVED_NAME)
      CSS.highlights.delete(SELECTION_NAME)
    },
    destroy() {
      this.clear()
      doc.querySelector(`[${STYLE_ATTR}]`)?.remove()
    },
  }
}
