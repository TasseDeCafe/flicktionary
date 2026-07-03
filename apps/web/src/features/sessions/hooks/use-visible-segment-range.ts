import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

export type VisibleSegmentRange = { shallowestIndex: number | null; deepestIndex: number | null }

// Min/max track indices among the currently-visible segment ids; ids with no
// index mapping are ignored. Exported for tests.
export const computeVisibleRange = (
  visibleIds: Iterable<string>,
  indexBySegmentId: ReadonlyMap<string, number>
): VisibleSegmentRange => {
  let min: number | null = null
  let max: number | null = null
  for (const id of visibleIds) {
    const idx = indexBySegmentId.get(id)
    if (idx === undefined) continue
    if (max === null || idx > max) max = idx
    if (min === null || idx < min) min = idx
  }
  return { shallowestIndex: min, deepestIndex: max }
}

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
): VisibleSegmentRange => {
  // Keep the latest map in a ref so the subscription doesn't tear down and
  // rewire the observers whenever the segment list re-derives. An id→index
  // change always comes with a DOM change, so the MutationObserver re-syncs
  // with the fresh map.
  const mapRef = useRef(indexBySegmentId)
  useEffect(() => {
    mapRef.current = indexBySegmentId
  })

  const store = useMemo(() => createVisibleRangeStore(scrollContainer, mapRef), [scrollContainer])
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

// External-store wrapper around the observer pair. The snapshot object is
// replaced only when the computed ends actually change, so getSnapshot stays
// referentially stable between store changes (a useSyncExternalStore
// requirement — a fresh object per read would loop).
const createVisibleRangeStore = (
  scrollContainer: HTMLElement | null,
  mapRef: { current: ReadonlyMap<string, number> }
) => {
  let snapshot: VisibleSegmentRange = { shallowestIndex: null, deepestIndex: null }
  // Ids currently intersecting the viewport; the snapshot is the min/max
  // indices among them, recomputed whenever the set changes.
  const visible = new Set<string>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (onStoreChange: () => void): (() => void) => {
      if (!scrollContainer) return () => {}
      const recompute = () => {
        const next = computeVisibleRange(visible, mapRef.current)
        if (next.shallowestIndex === snapshot.shallowestIndex && next.deepestIndex === snapshot.deepestIndex) return
        snapshot = next
        onStoreChange()
      }

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.segmentId
            if (!id) continue
            if (entry.isIntersecting) visible.add(id)
            else visible.delete(id)
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
        for (const id of visible) if (!present.has(id)) visible.delete(id)
        recompute()
      }
      syncObserved()
      const mutation = new MutationObserver(() => syncObserved())
      mutation.observe(scrollContainer, { childList: true, subtree: true })

      return () => {
        observer.disconnect()
        mutation.disconnect()
        visible.clear()
      }
    },
  }
}
