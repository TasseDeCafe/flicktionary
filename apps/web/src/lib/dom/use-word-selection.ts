import { useCallback, useEffect, useRef, useState } from 'react'

// Pointer-driven word-selection gesture, shared by the session view and the
// practice view. Replaces native browser text selection so the gestures can be
// simplified to: single click/tap selects a word; press-and-drag extends a
// range. The hook knows nothing view-specific — it operates purely on a single
// span contract:
//
//   * Every selectable word span carries `data-word-start` / `data-word-end`
//     (offsets in its enclosing container's coordinate system).
//   * An ancestor carries `data-word-owner` identifying the logical container
//     (segment id for the session view, paragraph id for the practice view).
//   * Two spans that render fragments of the *same* word (e.g. a highlight
//     chops it in half) share identical owner + start + end, so a click on
//     either selects the whole word.
//
// Selection is painted by writing `data-word-selected="true"` directly to the
// DOM (not React state) so an in-flight drag doesn't fight reconciliation; CSS
// styles the painted spans. The caller maps the emitted endpoints to its own
// domain selection type.

// A selected word, addressed by its owner + offsets rather than a DOM ref so
// re-renders mid-drag don't invalidate it.
export type WordKey = {
  ownerKey: string
  wordStart: number
  wordEnd: number
}

type WordSelection = {
  anchor: WordKey
  end: WordKey
  // Bounding rect of the painted span run, for anchoring the floating sheet.
  rect: DOMRect
}

// Callback ref the caller spreads onto the container element. Using a callback
// ref (rather than accepting a RefObject) is load-bearing: it lets the listener
// effect re-run whenever the real container *mounts* — which, on a cold load,
// happens several commits after the hook first runs (the first commit is a
// loading screen with no container). A RefObject would attach listeners exactly
// once, miss the late-mounting node, and silently never select anything.
export type ContainerRef = (el: HTMLElement | null) => void

type UseWordSelectionParams = {
  // Bails the gesture at pointerdown when true, so the view's own onClick
  // handlers (highlight / annotation taps) fire normally.
  isBlockedTarget: (el: Element) => boolean
  onSelect: (selection: WordSelection) => void
  // Session view (long scrollable list) only; practice texts are short.
  enableEdgeAutoScroll: boolean
  // When false the gesture listeners aren't attached (e.g. a read-only block).
  // Defaults to true.
  enabled?: boolean
}

// Commit to a horizontal drag only once it dominates and clears this many px;
// until then a vertical-first touch falls through to native `pan-y` scroll.
const AXIS_THRESHOLD = 6
// Past this much vertical movement (before a horizontal drag or long-press has
// committed), a touch is treated as a scroll and the gesture aborts.
const VERTICAL_SLOP = 10
// Hold this long on a word (touch, finger roughly still) to enter selection
// mode — after which a drag in *any* direction extends the selection and native
// scrolling is suppressed. This is the only way to start a downward selection
// on touch, since `touch-action: pan-y` otherwise hands vertical drags to the
// scroller.
const LONG_PRESS_MS = 350
const EDGE_ZONE = 40
const SCROLL_STEP = 6

const clearPaintIn = (container: HTMLElement) => {
  for (const el of container.querySelectorAll('[data-word-selected]')) {
    el.removeAttribute('data-word-selected')
    el.removeAttribute('data-word-selected-edge')
  }
}

const keyOf = (span: Element): WordKey | null => {
  const wsAttr = span.getAttribute('data-word-start')
  const weAttr = span.getAttribute('data-word-end')
  if (wsAttr == null || weAttr == null) return null
  const owner = span.closest('[data-word-owner]')?.getAttribute('data-word-owner')
  if (owner == null) return null
  const wordStart = Number(wsAttr)
  const wordEnd = Number(weAttr)
  if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) return null
  return { ownerKey: owner, wordStart, wordEnd }
}

const sameKey = (a: WordKey, b: WordKey) =>
  a.ownerKey === b.ownerKey && a.wordStart === b.wordStart && a.wordEnd === b.wordEnd

type GestureState = {
  phase: 'idle' | 'pressed' | 'dragging'
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  lastX: number
  lastY: number
  anchor: WordKey | null
  end: WordKey | null
  autoDir: number
  rafId: number
  longPressId: ReturnType<typeof setTimeout> | null
}

export const useWordSelection = ({
  isBlockedTarget,
  onSelect,
  enableEdgeAutoScroll,
  enabled = true,
}: UseWordSelectionParams): { ref: ContainerRef; clearPaint: () => void } => {
  // The container node, tracked as state via a callback ref so the listener
  // effect re-binds when the node mounts, unmounts, or is replaced.
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const ref = useCallback<ContainerRef>((el) => setContainer(el), [])

  // Keep callbacks in a ref so the listener effect stays bound across
  // re-renders without re-binding (and without stale closures). Updated in an
  // effect rather than during render so it's safe under the React Compiler.
  const cbRef = useRef({ isBlockedTarget, onSelect, enableEdgeAutoScroll })
  useEffect(() => {
    cbRef.current = { isBlockedTarget, onSelect, enableEdgeAutoScroll }
  })

  const clearPaint = useCallback(() => {
    if (container) clearPaintIn(container)
  }, [container])

  useEffect(() => {
    if (!container || !enabled) return

    const st: GestureState = {
      phase: 'idle',
      pointerId: -1,
      pointerType: '',
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      anchor: null,
      end: null,
      autoDir: 0,
      rafId: 0,
      longPressId: null,
    }

    // Paint every leaf piece from `anchor` to `end` inclusive, in document
    // order. We walk *all* pieces (words and the whitespace/punctuation between
    // them, tagged `data-word-piece`) — not just word spans — so the painted
    // band is continuous across spaces instead of one box per word. Only word
    // pieces carry a key, so the anchor/end endpoints still resolve to whole
    // words; the pieces between them are swept in by the min/max index range.
    // Document order is read straight off the DOM, so dragging upward (end
    // earlier than anchor) and dragging across owners both work. Returns false
    // if either endpoint has vanished from the DOM (e.g. a re-render dropped it).
    const paintSelection = (anchor: WordKey, end: WordKey): boolean => {
      const spans = Array.from(container.querySelectorAll('[data-word-piece]'))
      let aFirst = -1
      let aLast = -1
      let eFirst = -1
      let eLast = -1
      spans.forEach((s, i) => {
        const k = keyOf(s)
        if (!k) return
        if (sameKey(k, anchor)) {
          if (aFirst < 0) aFirst = i
          aLast = i
        }
        if (sameKey(k, end)) {
          if (eFirst < 0) eFirst = i
          eLast = i
        }
      })
      if (aFirst < 0 || eFirst < 0) return false
      const lo = Math.min(aFirst, eFirst)
      const hi = Math.max(aLast, eLast)
      clearPaintIn(container)
      for (let i = lo; i <= hi; i++) spans[i]!.setAttribute('data-word-selected', 'true')
      // Tag the run's edge pieces so CSS can round only the OUTER corners —
      // rounding every piece would notch the wash at each word/space boundary
      // (extension-overlay parity: its painted runs round outer corners only).
      spans[lo]!.setAttribute('data-word-selected-edge', lo === hi ? 'both' : 'start')
      if (hi > lo) spans[hi]!.setAttribute('data-word-selected-edge', 'end')
      return true
    }

    const computeRect = (): DOMRect | null => {
      const painted = container.querySelectorAll('[data-word-selected]')
      if (painted.length === 0) return null
      const range = document.createRange()
      range.setStartBefore(painted[0]!)
      range.setEndAfter(painted[painted.length - 1]!)
      return range.getBoundingClientRect()
    }

    // Re-resolve the end word from the point under the pointer and repaint.
    const resolveEnd = (x: number, y: number) => {
      if (!st.anchor) return
      const el = document.elementFromPoint(x, y)
      const span = el?.closest('[data-word-start]')
      if (!span || !container.contains(span)) return
      const k = keyOf(span)
      if (!k) return
      st.end = k
      paintSelection(st.anchor, k)
    }

    const stopAutoScroll = () => {
      st.autoDir = 0
      if (st.rafId) {
        cancelAnimationFrame(st.rafId)
        st.rafId = 0
      }
    }

    const autoScrollStep = () => {
      if (st.autoDir === 0) {
        st.rafId = 0
        return
      }
      container.scrollTop += st.autoDir
      resolveEnd(st.lastX, st.lastY)
      st.rafId = requestAnimationFrame(autoScrollStep)
    }

    const updateAutoScroll = (y: number) => {
      const rect = container.getBoundingClientRect()
      let dir = 0
      if (y < rect.top + EDGE_ZONE) dir = -SCROLL_STEP
      else if (y > rect.bottom - EDGE_ZONE) dir = SCROLL_STEP
      st.autoDir = dir
      if (dir !== 0 && st.rafId === 0) st.rafId = requestAnimationFrame(autoScrollStep)
    }

    const cancelLongPress = () => {
      if (st.longPressId !== null) {
        clearTimeout(st.longPressId)
        st.longPressId = null
      }
    }

    const resetState = () => {
      stopAutoScroll()
      cancelLongPress()
      st.phase = 'idle'
      st.pointerId = -1
      st.anchor = null
      st.end = null
    }

    const onPointerDown = (e: PointerEvent) => {
      // Block right-click and secondary touches before any paint or capture.
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
      const target = e.target instanceof Element ? e.target : null
      if (!target) return
      if (cbRef.current.isBlockedTarget(target)) return
      const span = target.closest('[data-word-start]')
      clearPaintIn(container)
      if (!span || !container.contains(span)) {
        resetState()
        return
      }
      const key = keyOf(span)
      if (!key) {
        resetState()
        return
      }
      try {
        container.setPointerCapture(e.pointerId)
      } catch {
        // Capture can fail if the pointer was already released; harmless.
      }
      st.phase = 'pressed'
      st.pointerId = e.pointerId
      st.pointerType = e.pointerType
      st.startX = e.clientX
      st.startY = e.clientY
      st.lastX = e.clientX
      st.lastY = e.clientY
      st.anchor = key
      st.end = key
      paintSelection(key, key)
      // Touch: arm a long-press. If the finger stays roughly still until it
      // fires, we enter drag mode so a drag in any direction (incl. downward)
      // extends the selection instead of scrolling.
      if (e.pointerType !== 'mouse') {
        st.longPressId = setTimeout(() => {
          st.longPressId = null
          if (st.phase === 'pressed') st.phase = 'dragging'
        }, LONG_PRESS_MS)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (st.phase === 'idle' || e.pointerId !== st.pointerId) return
      st.lastX = e.clientX
      st.lastY = e.clientY
      if (st.phase === 'pressed') {
        const dx = e.clientX - st.startX
        const dy = e.clientY - st.startY
        if (st.pointerType === 'mouse') {
          // No scroll competes with a mouse drag — commit on any movement, so a
          // straight-down drag selects too.
          if (Math.abs(dx) > AXIS_THRESHOLD || Math.abs(dy) > AXIS_THRESHOLD) {
            st.phase = 'dragging'
          } else {
            return
          }
        } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > AXIS_THRESHOLD) {
          // Horizontal-dominant touch: commit to an in-line drag immediately.
          cancelLongPress()
          st.phase = 'dragging'
        } else if (Math.abs(dy) > VERTICAL_SLOP) {
          // Vertical-first touch before the long-press fired → this is a scroll.
          // Abort and let native pan take over.
          clearPaintIn(container)
          resetState()
          return
        } else {
          // Small jitter — keep waiting for the long-press or a clearer move.
          return
        }
      }
      // Suppress further scrolling once committed to a drag.
      e.preventDefault()
      resolveEnd(e.clientX, e.clientY)
      if (cbRef.current.enableEdgeAutoScroll) updateAutoScroll(e.clientY)
    }

    // On touch, `touch-action: pan-y` makes vertical `pointermove`s
    // non-cancelable, so we additionally preventDefault the underlying
    // `touchmove` once dragging to actually stop scroll / pull-to-refresh.
    const onTouchMove = (e: TouchEvent) => {
      if (st.phase === 'dragging') e.preventDefault()
    }

    const onPointerUp = (e: PointerEvent) => {
      if (st.phase === 'idle' || e.pointerId !== st.pointerId) return
      try {
        container.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      const anchor = st.anchor
      const end = st.end
      stopAutoScroll()
      if (anchor && end) {
        const rect = computeRect()
        if (rect) cbRef.current.onSelect({ anchor, end, rect })
      }
      // The paint PERSISTS past release (extension-overlay parity): it keeps
      // showing what the open gloss sheet refers to. It clears on the next
      // pointerdown, on cancel, or when the consumer calls clearPaint — which
      // every onSelect bail path and sheet-close handler must do, since this
      // no longer sweeps up after them.
      resetState()
    }

    const onPointerCancel = () => {
      clearPaintIn(container)
      resetState()
    }

    const onContextMenu = (e: Event) => {
      e.preventDefault()
    }

    container.addEventListener('pointerdown', onPointerDown)
    // Non-passive so `preventDefault` can suppress scroll once dragging.
    container.addEventListener('pointermove', onPointerMove, { passive: false })
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', onPointerCancel)
    container.addEventListener('contextmenu', onContextMenu)
    container.addEventListener('touchmove', onTouchMove, { passive: false })

    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerCancel)
      container.removeEventListener('contextmenu', onContextMenu)
      container.removeEventListener('touchmove', onTouchMove)
      stopAutoScroll()
      cancelLongPress()
      clearPaintIn(container)
    }
  }, [container, enabled])

  return { ref, clearPaint }
}
