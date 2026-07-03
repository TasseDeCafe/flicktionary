import { useMemo, useSyncExternalStore } from 'react'

export type SegmentPosition = 'above' | 'visible' | 'below' | null

// Classifies an observer entry relative to the scroll viewport: 'visible' when
// any part is on screen; otherwise the target's top is compared to the root's
// top edge to tell above from below (rootBounds is the scroll container's
// rect). Exported for tests.
export const segmentPositionFromEntry = (entry: {
  isIntersecting: boolean
  rootBounds: { top: number } | null
  boundingClientRect: { top: number }
}): SegmentPosition =>
  entry.isIntersecting ? 'visible' : entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) ? 'above' : 'below'

// Reports where a single segment sits relative to the scroll viewport: 'visible'
// when any part is on screen, otherwise 'above' / 'below'. Returns null when the
// target isn't rendered (e.g. filtered out during search) or hasn't been resolved
// yet. Backs the "jump to your last highlight" affordance — the button shows (with
// a direction-aware chevron) only when the anchor segment is off screen.
//
// Driven by an IntersectionObserver scoped to the scroll container, so it fires on
// enter/leave rather than on every scroll frame. The initial callback on observe()
// gives us the starting position even if the segment is far off screen and never
// crossed the threshold during this subscription.
export const useSegmentPosition = (scrollContainer: HTMLElement | null, segmentId: string | null): SegmentPosition => {
  const store = useMemo(() => createSegmentPositionStore(scrollContainer, segmentId), [scrollContainer, segmentId])
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

// External-store wrapper around the observer pair. The snapshot starts null
// (nothing observed yet, or nothing to observe); a new (container, segment)
// pair gets a fresh store via the useMemo above, so the value resets to null
// instead of carrying the previous target's position while the first
// observation is in flight.
const createSegmentPositionStore = (scrollContainer: HTMLElement | null, segmentId: string | null) => {
  let position: SegmentPosition = null
  return {
    getSnapshot: () => position,
    subscribe: (onStoreChange: () => void): (() => void) => {
      if (!scrollContainer || !segmentId) return () => {}
      const report = (next: SegmentPosition) => {
        if (next === position) return
        position = next
        onStoreChange()
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1]
          if (entry) report(segmentPositionFromEntry(entry))
        },
        { root: scrollContainer, threshold: 0 }
      )

      // Re-resolve the target row whenever the rendered list changes — the row
      // mounts after highlights load, and search filtering unmounts/remounts it
      // as a fresh node. Re-point the observer only when the node actually
      // changes so selection repaint mutations don't thrash it.
      let observed: Element | null = null
      const resolve = () => {
        const target = scrollContainer.querySelector(`[data-segment-id="${segmentId}"]`)
        if (target === observed) return
        if (observed) observer.unobserve(observed)
        observed = target
        if (target) observer.observe(target)
        else report(null)
      }
      resolve()
      const mutation = new MutationObserver(() => resolve())
      mutation.observe(scrollContainer, { childList: true, subtree: true })

      return () => {
        observer.disconnect()
        mutation.disconnect()
      }
    },
  }
}
