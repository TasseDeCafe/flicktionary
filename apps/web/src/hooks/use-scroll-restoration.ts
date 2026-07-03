import type React from 'react'
import { useEffect, useRef } from 'react'

// Module-level so a saved offset survives the scroll container unmounting
// (e.g. while the user is in the focus view). Scoped by `scope` so different
// list views can't clobber each other. Lost on hard reload — bump to
// sessionStorage if survival across reloads is wanted.
const scrollPositions = new Map<string, { key: string; offset: number }>()

export const useScrollRestoration = <T extends HTMLElement>({
  scope,
  filterKey,
  ready,
}: {
  scope: string
  filterKey: string
  ready: boolean
}) => {
  const ref = useRef<T | null>(null)
  const restoredKeyRef = useRef<string | null>(null)

  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler -- imperative scrollTop restore that must run AFTER the list rows have rendered (`ready` flips when data lands); it is a post-render DOM write, not a reaction to a user event */
    if (restoredKeyRef.current === filterKey) return
    if (!ready) return
    const saved = scrollPositions.get(scope)
    if (saved && saved.key === filterKey && saved.offset > 0 && ref.current) {
      ref.current.scrollTop = saved.offset
    }
    restoredKeyRef.current = filterKey
    /* eslint-enable react-you-might-not-need-an-effect/no-event-handler */
  }, [scope, filterKey, ready])

  const onScroll = (e: React.UIEvent<T>) => {
    scrollPositions.set(scope, { key: filterKey, offset: e.currentTarget.scrollTop })
  }

  return { ref, onScroll }
}
