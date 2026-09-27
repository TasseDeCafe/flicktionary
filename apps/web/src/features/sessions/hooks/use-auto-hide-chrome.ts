import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

// Sustained travel in one direction before the chrome reacts, so a jittery
// thumb or an iOS bounce doesn't flicker it. Revealing asks for a bit more
// intent than hiding: scrolling back a line to re-read shouldn't bring it back.
const HIDE_AFTER_PX = 32
const REVEAL_AFTER_PX = 64
// Near the top of the text the chrome always shows.
const TOP_ZONE_PX = 56
// A mouse this close to the top of the window brings the chrome back, the way
// fullscreen video controls return (desktop has no top strip to tap).
const MOUSE_REVEAL_EDGE_PX = 40

// Reading-mode chrome: hide the reader's header/footer while the user scrolls
// down through the text, bring them back on a deliberate scroll up. Only real
// user scrolls count — programmatic ones (resume, jumps) run inside the
// caller's suppression window and just re-baseline. The bars collapse in the
// layout rather than overlaying, so scrollTop never moves when they toggle
// (the text slides with the gesture, as in Safari) and no feedback loop forms.
// `reveal` is the explicit way back (top-strip tap, Esc).
export const useAutoHideChrome = (scrollEl: HTMLElement | null, programmaticScrollUntilRef: RefObject<number>) => {
  const [hidden, setHidden] = useState(false)
  // Shared with `reveal`, which must zero it: travel already past the hide
  // threshold would otherwise re-hide on the next pixel of scroll.
  const travelRef = useRef(0)

  const reveal = useCallback(() => {
    travelRef.current = 0
    setHidden(false)
  }, [])

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.clientY < MOUSE_REVEAL_EDGE_PX) reveal()
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [reveal])

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
