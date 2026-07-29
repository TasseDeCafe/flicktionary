import { type RefObject, useEffect } from 'react'

// iOS Safari overlays the on-screen keyboard on an unchanged layout viewport
// (WebKit doesn't support `interactive-widget=resizes-content`,
// https://bugs.webkit.org/show_bug.cgi?id=259770 — remove this once it does),
// so full-height screens and their bottom-anchored CTAs end up hidden behind
// the keyboard. While the keyboard is up, pin the element to the *visual*
// viewport instead: shrink it to the visible height and shift it under any
// focus-scroll offset so its bottom bar rides just above the keyboard.
//
// The element must be positioned (`relative` or `fixed`) for the `top` offset
// to take effect. Browsers that resize the layout viewport for the keyboard
// (Chrome/Firefox on Android) never trip the overlap check, and pinch-zoom
// cancels out of it, so everywhere else this is a no-op.
export const useVisualViewportPin = (ref: RefObject<HTMLElement | null>, enabled = true) => {
  useEffect(() => {
    if (!enabled) return
    const vv = window.visualViewport
    const el = ref.current
    if (!vv || !el) return
    const clear = () => {
      el.style.height = ''
      el.style.top = ''
      el.style.bottom = ''
    }
    const apply = (revealFocusedField: boolean) => {
      // Scale-normalized visual height matches the layout viewport during
      // pinch-zoom and on desktop; only an overlaying keyboard (~260px+ on
      // iOS) opens a real gap.
      const keyboardOverlap = document.documentElement.clientHeight - vv.height * vv.scale
      if (keyboardOverlap < 100) {
        clear()
        return
      }
      el.style.height = `${vv.height}px`
      el.style.top = `${vv.offsetTop}px`
      el.style.bottom = 'auto'
      // Safari scrolls the focused field into view against the pre-shrink
      // geometry, so after pinning it can sit just below the fold of the
      // now-shorter scroll area. Re-reveal it once layout has settled — only
      // on height changes, not on visual-viewport pans, so a user scrolling
      // the content with the keyboard open isn't yanked back to the field.
      if (revealFocusedField) {
        requestAnimationFrame(() => {
          const active = document.activeElement
          if (active instanceof HTMLElement && el.contains(active)) {
            // Stop short of flush with the scroll container's edge so the
            // focus ring (drawn just outside the border box) isn't clipped.
            const previousScrollMargin = active.style.scrollMargin
            active.style.scrollMargin = '8px'
            active.scrollIntoView({ block: 'nearest' })
            active.style.scrollMargin = previousScrollMargin
          }
        })
      }
    }
    const onResize = () => apply(true)
    const onScroll = () => apply(false)
    apply(true)
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onScroll)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onScroll)
      clear()
    }
  }, [ref, enabled])
}
