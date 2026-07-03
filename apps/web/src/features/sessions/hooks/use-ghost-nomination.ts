import { useEffect, useRef } from 'react'
import type { NominatedWindow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useNominateWindow } from '../api/sessions-hooks'
import { useDebouncedValue } from './use-debounced-value'

// Reading windows are fixed-size, aligned blocks of segment indices. Aligning makes
// coverage a plain set of window indices: a window is requested at most once, server
// coverage rehydrates the set deterministically on reload, and back-scrolling never
// re-requests. Sized in segments (subtitle lines are short, so this proxies a
// char/token budget well enough); LOOKAHEAD pulls nomination ahead of the reader so
// outlines appear in the window they're about to read, and BACK_MARGIN covers the
// window they're currently reading (the viewport's top sits behind its deepest row).
const WINDOW_SIZE = 25
const LOOKAHEAD_SEGMENTS = 25
const BACK_MARGIN_SEGMENTS = WINDOW_SIZE

// Only nominate once the reader has settled — a fast scroll-through never lingers
// long enough to fire, so we don't burn an Opus call per window flown past. Each
// nominate job is an LLM call, so this debounce is the main cost control.
const SETTLE_MS = 700

const windowIndexFor = (segmentIndex: number): number => Math.floor(segmentIndex / WINDOW_SIZE)

// Drives per-window nomination from the reader's settled position. Holds the set of
// already-requested window indices (seeded from the server's coverage set so a reload
// resumes), and on settle requests any uncovered window overlapping
// [pos - BACK_MARGIN, pos + LOOKAHEAD]. Because the position is the *current* deepest-
// visible segment (not a monotonic max) and is debounced, this both avoids requesting
// windows the reader merely scrolled past AND covers a window they scroll back to.
// Fully inert when disabled (LLM suggestions off) — it never requests a window.
export const useGhostNomination = (params: {
  sessionId: string
  deepestIndex: number | null
  maxSegmentIndex: number | null
  serverWindows: readonly NominatedWindow[] | undefined
  enabled: boolean
}): { isRequesting: boolean } => {
  const { sessionId, deepestIndex, maxSegmentIndex, serverWindows, enabled } = params
  const { mutate: nominateWindow, isPending: isRequesting } = useNominateWindow(sessionId)
  // Wait for the reader to settle before nominating around their position.
  const settledIndex = useDebouncedValue(deepestIndex, SETTLE_MS)
  // Window indices we've already requested (locally or per the server). A ref so
  // requesting doesn't trigger re-renders; reads stay current within the effect.
  const requestedRef = useRef<Set<number>>(new Set())

  // Seed/merge the server coverage set so reloads (and an earlier session) don't
  // re-request covered windows.
  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- merges async-loaded server coverage into the local requested set whenever the query (re)delivers; there is no event site, and missing a merge would re-request already-covered windows (paid LLM calls)
    if (!serverWindows) return
    for (const w of serverWindows) requestedRef.current.add(windowIndexFor(w.startIndex))
  }, [serverWindows])

  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler -- the trigger is the reader SETTLING on a scroll position (debounced index), a time-based signal with no discrete event handler to move into */
    if (!enabled) return
    if (settledIndex === null || maxSegmentIndex === null) return

    const firstWindow = windowIndexFor(Math.max(0, settledIndex - BACK_MARGIN_SEGMENTS))
    const lastWindow = windowIndexFor(Math.min(settledIndex + LOOKAHEAD_SEGMENTS, maxSegmentIndex))
    for (let w = firstWindow; w <= lastWindow; w++) {
      if (requestedRef.current.has(w)) continue
      requestedRef.current.add(w)
      const startIndex = w * WINDOW_SIZE
      if (startIndex > maxSegmentIndex) continue
      const endIndex = Math.min(startIndex + WINDOW_SIZE - 1, maxSegmentIndex)
      nominateWindow({ sessionId, startIndex, endIndex })
    }
    /* eslint-enable react-you-might-not-need-an-effect/no-event-handler */
  }, [enabled, settledIndex, maxSegmentIndex, sessionId, nominateWindow])

  return { isRequesting }
}
