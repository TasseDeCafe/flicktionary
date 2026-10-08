import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

// Sustained travel in one direction before the chrome reacts, so a jittery
// thumb or an iOS bounce doesn't flicker it. Revealing asks for a bit more
// intent than hiding: scrolling back a line to re-read shouldn't bring it back.
const HIDE_AFTER_PX = 32
const REVEAL_AFTER_PX = 64
// Near the top of the text the chrome always shows.
const TOP_ZONE_PX = 56
// A mouse at the very top edge of the window brings the chrome back, the way
// fullscreen video controls return (desktop has no top strip to tap). Only the
// edge itself — the progress bar's height — so the band never overlaps the
// first line of text, where a word lookup or a passing mouse would trigger it.
const MOUSE_REVEAL_EDGE_PX = 4

// Reading-mode chrome: hide the reader's header/footer while the user scrolls
// down through the text, bring them back on a deliberate scroll up. Only real
// user scrolls count — programmatic ones (resume, jumps) run inside the
// caller's suppression window and just re-baseline. The bars collapse in the
// layout rather than overlaying, so scrollTop never moves when they toggle
// (the text slides with the gesture, as in Safari) and no feedback loop forms.
// `reveal` is the explicit way back (top-strip tap, Esc).
// `mouseRevealBlocked` turns the mouse edge off while the user is interacting
// with the text (e.g. the gloss sheet is open): revealing pushes the text down,
// which would move the word and the sheet anchored to it.
export const useAutoHideChrome = (
  scrollEl: HTMLElement | null,
  programmaticScrollUntilRef: RefObject<number>,
  mouseRevealBlocked: boolean
) => {
  const [hidden, setHidden] = useState(false)
  // Shared with `reveal`, which must zero it: travel already past the hide
  // threshold would otherwise re-hide on the next pixel of scroll.
  const travelRef = useRef(0)

  const reveal = useCallback(() => {
    travelRef.current = 0
    setHidden(false)
  }, [])

  useEffect(() => {
    if (mouseRevealBlocked) return
    // A held button means a drag-select (or a scrollbar drag) passing the top,
    // not a request for the chrome.
    const atTopEdge = (e: MouseEvent) => e.buttons === 0 && e.clientY < MOUSE_REVEAL_EDGE_PX
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && atTopEdge(e)) reveal()
    }
    // In a windowed browser a quick flick upward leaves the page without a
    // pointermove landing in the thin edge band — leaving through the top
    // counts as reaching it.
    const onMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget && atTopEdge(e)) reveal()
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('mouseout', onMouseOut)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('mouseout', onMouseOut)
    }
  }, [reveal, mouseRevealBlocked])

  useEffect(() => {
    if (!scrollEl) return
    const clampedTop = () =>
      Math.min(Math.max(0, scrollEl.scrollTop), Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight))
    let lastTop = clampedTop()
    travelRef.current = 0
    const onScroll = () => {
      const top = clampedTop()
      const delta = top - lastTop
      lastTop = top
      if (Date.now() < programmaticScrollUntilRef.current) {
        travelRef.current = 0
        return
      }
      if (top < TOP_ZONE_PX) {
        travelRef.current = 0
        setHidden(false)
        return
      }
      if (delta === 0) return
      // Direction change restarts the accumulator.
      if (Math.sign(delta) !== Math.sign(travelRef.current)) travelRef.current = 0
      travelRef.current += delta
      if (travelRef.current > HIDE_AFTER_PX) setHidden(true)
      else if (travelRef.current < -REVEAL_AFTER_PX) setHidden(false)
    }
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollEl.removeEventListener('scroll', onScroll)
  }, [scrollEl, programmaticScrollUntilRef])

  return { hidden, reveal }
}
