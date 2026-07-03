import { useEffect, useRef, useState } from 'react'

// Reports the [shallowest, deepest] band of segment indices CURRENTLY in view,
// via an IntersectionObserver over the rendered [data-segment-id] rows. Both
// ends follow the viewport in both directions (they drop back as the reader
// scrolls up), so a consumer can ask "does range X overlap what the reader is
// looking at right now?" — used by the footer loader to decide whether a
// pending nomination window actually affects on-screen text or just lookahead.
//
// Driving off two integers keeps it decoupled from the display layer: it works
// whether all rows are mounted (today) or only a windowed slice is (a future
// virtualized / book reader), because it observes whatever rows are actually in
// the DOM. `indexBySegmentId` maps each rendered segment id to its
// track-relative index, so the reported values are stable track indices, never
// client array positions.
export const useVisibleSegmentRange = (
  scrollContainer: HTMLElement | null,
  indexBySegmentId: Map<string, number>
): { shallowestIndex: number | null; deepestIndex: number | null } => {
  const [shallowestIndex, setShallowestIndex] = useState<number | null>(null)
  const [deepestIndex, setDeepestIndex] = useState<number | null>(null)
  // Ids currently intersecting the viewport; the reported values are the min
  // and max indices among them, recomputed whenever the set changes.
  const visibleRef = useRef<Set<string>>(new Set())
  // Keep the latest map in a ref so the observer callback resolves ids without
  // the effect re-binding (and tearing down the observer) on every render.
  const mapRef = useRef(indexBySegmentId)
  useEffect(() => {
    mapRef.current = indexBySegmentId
  })

  useEffect(() => {
    if (!scrollContainer) return

    const recompute = () => {
      let max: number | null = null
      let min: number | null = null
      for (const id of visibleRef.current) {
        const idx = mapRef.current.get(id)
        if (idx === undefined) continue
        if (max === null || idx > max) max = idx
        if (min === null || idx < min) min = idx
      }
      setDeepestIndex((prev) => (prev === max ? prev : max))
      setShallowestIndex((prev) => (prev === min ? prev : min))
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
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-external-store-subscription -- Intersection/MutationObserver wiring with visible-set pruning; a useSyncExternalStore rewrite is evaluated in phase 5 of docs/proposals/add-eslint-effect.md (reading-position machinery, manual golden path required)
    syncObserved()
    const mutation = new MutationObserver(() => syncObserved())
    mutation.observe(scrollContainer, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mutation.disconnect()
      visibleRef.current.clear()
    }
  }, [scrollContainer])

  return { shallowestIndex, deepestIndex }
}
