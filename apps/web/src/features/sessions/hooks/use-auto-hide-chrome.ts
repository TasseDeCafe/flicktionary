import { useEffect, useState, type RefObject } from 'react'

// Sustained travel in one direction before the chrome reacts, so a jittery
// thumb or an iOS bounce doesn't flicker it. Revealing asks for a bit more
// intent than hiding: scrolling back a line to re-read shouldn't bring it back.
const HIDE_AFTER_PX = 32
const REVEAL_AFTER_PX = 64
// Near the top of the text the chrome always shows.
const TOP_ZONE_PX = 56

// Reading-mode chrome: hide the reader's header/footer while the user scrolls
// down through the text, bring them back on a deliberate scroll up. Only real
// user scrolls count — programmatic ones (resume, jumps) run inside the
// caller's suppression window and just re-baseline. The bars collapse in the
// layout rather than overlaying, so scrollTop never moves when they toggle
// (the text slides with the gesture, as in Safari) and no feedback loop forms.
export const useAutoHideChrome = (scrollEl: HTMLElement | null, programmaticScrollUntilRef: RefObject<number>) => {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!scrollEl) return
    const clampedTop = () =>
      Math.min(Math.max(0, scrollEl.scrollTop), Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight))
    let lastTop = clampedTop()
    let travel = 0
    const onScroll = () => {
      const top = clampedTop()
      const delta = top - lastTop
      lastTop = top
      if (Date.now() < programmaticScrollUntilRef.current) {
        travel = 0
        return
      }
      if (top < TOP_ZONE_PX) {
        travel = 0
        setHidden(false)
        return
      }
      if (delta === 0) return
      // Direction change restarts the accumulator.
      if (Math.sign(delta) !== Math.sign(travel)) travel = 0
      travel += delta
      if (travel > HIDE_AFTER_PX) setHidden(true)
      else if (travel < -REVEAL_AFTER_PX) setHidden(false)
    }
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollEl.removeEventListener('scroll', onScroll)
  }, [scrollEl, programmaticScrollUntilRef])

  return hidden
}
