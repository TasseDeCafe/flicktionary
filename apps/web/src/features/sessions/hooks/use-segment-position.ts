import { useEffect, useState } from 'react'

export type SegmentPosition = 'above' | 'visible' | 'below' | null

// Reports where a single segment sits relative to the scroll viewport: 'visible'
// when any part is on screen, otherwise 'above' / 'below'. Returns null when the
// target isn't rendered (e.g. filtered out during search) or hasn't been resolved
// yet. Backs the "jump to your last highlight" affordance — the button shows (with
// a direction-aware chevron) only when the anchor segment is off screen.
//
// Driven by an IntersectionObserver scoped to the scroll container, so it fires on
// enter/leave rather than on every scroll frame. The initial synchronous callback
// gives us the starting position even if the segment is far off screen and never
// crossed the threshold during this mount.
export const useSegmentPosition = (scrollContainer: HTMLElement | null, segmentId: string | null): SegmentPosition => {
  const [position, setPosition] = useState<SegmentPosition>(null)

  useEffect(() => {
    if (!scrollContainer || !segmentId) {
      setPosition(null)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        if (entry.isIntersecting) {
          setPosition('visible')
          return
        }
        // rootBounds is the scroll container's rect; compare the target's top to
        // its top edge to tell above from below.
        const rootTop = entry.rootBounds?.top ?? 0
        setPosition(entry.boundingClientRect.top < rootTop ? 'above' : 'below')
      },
      { root: scrollContainer, threshold: 0 }
    )

    // Re-resolve the target row whenever the rendered list changes — the row mounts
    // after highlights load, and search filtering unmounts/remounts it as a fresh
    // node. Re-point the observer only when the node actually changes so selection
    // repaint mutations don't thrash it.
    let observed: Element | null = null
    const resolve = () => {
      const target = scrollContainer.querySelector(`[data-segment-id="${segmentId}"]`)
      if (target === observed) return
      if (observed) observer.unobserve(observed)
      observed = target
      if (target) observer.observe(target)
      else setPosition(null)
    }
    resolve()
    const mutation = new MutationObserver(() => resolve())
    mutation.observe(scrollContainer, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mutation.disconnect()
    }
  }, [scrollContainer, segmentId])

  return position
}
