import { useEffect, useRef, useState } from 'react'

// Reports the deepest (highest-index) segment CURRENTLY in view, via an
// IntersectionObserver over the rendered [data-segment-id] rows. Unlike a
// monotonic "deepest reached", this follows the viewport both ways — it drops back
// down when the reader scrolls up — so nomination can cover a window the reader
// scrolled back to (paired with a settle debounce in useGhostNomination, a fast
// fly-through never settles on those windows and so never requests them).
//
// Driving off a single integer keeps it decoupled from the display layer: it works
// whether all rows are mounted (today) or only a windowed slice is (a future
// virtualized / book reader), because it observes whatever rows are actually in the
// DOM. `indexBySegmentId` maps each rendered segment id to its track-relative index,
// so the reported value is a stable track index, never a client array position.
export const useDeepestVisibleSegment = (
  scrollContainer: HTMLElement | null,
  indexBySegmentId: Map<string, number>
): number | null => {
  const [deepestVisibleIndex, setDeepestVisibleIndex] = useState<number | null>(null)
  // Ids currently intersecting the viewport; the reported value is the max index
  // among them, recomputed whenever the set changes.
  const visibleRef = useRef<Set<string>>(new Set())
  // Keep the latest map in a ref so the observer callback resolves ids without the
  // effect re-binding (and tearing down the observer) on every render.
  const mapRef = useRef(indexBySegmentId)
  useEffect(() => {
    mapRef.current = indexBySegmentId
  })

  useEffect(() => {
    if (!scrollContainer) return

    const recompute = () => {
      let max: number | null = null
      for (const id of visibleRef.current) {
        const idx = mapRef.current.get(id)
        if (idx === undefined) continue
        if (max === null || idx > max) max = idx
      }
      setDeepestVisibleIndex((prev) => (prev === max ? prev : max))
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.segmentId
          if (!id) continue
          if (entry.isIntersecting) visibleRef.current.add(id)
          else visibleRef.current.delete(id)
        }
        recompute()
      },
      { root: scrollContainer, threshold: 0 }
    )

    // Observe whatever rows are currently mounted, and prune any visible ids whose
    // rows have left the DOM (e.g. a search filter swapped the list) — those never
    // get an isIntersecting=false callback, so they'd otherwise pin a stale max. A
    // MutationObserver re-runs this for rows added/removed later (search, or a future
    // virtualized list).
    const syncObserved = () => {
      const present = new Set<string>()
      for (const el of scrollContainer.querySelectorAll('[data-segment-id]')) {
        const id = (el as HTMLElement).dataset.segmentId
        if (id) present.add(id)
        observer.observe(el)
      }
      for (const id of visibleRef.current) if (!present.has(id)) visibleRef.current.delete(id)
      recompute()
    }
    syncObserved()
    const mutation = new MutationObserver(() => syncObserved())
    mutation.observe(scrollContainer, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mutation.disconnect()
      visibleRef.current.clear()
    }
  }, [scrollContainer])

  return deepestVisibleIndex
}
