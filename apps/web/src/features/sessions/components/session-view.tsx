import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ChevronDown } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import type { FloatingSheetAnchor } from '@flicktionary/ui/components/floating-sheet'
import { useDebouncedValue } from '../hooks/use-debounced-value'
import {
  isOptimisticHighlightId,
  useCreateHighlight,
  useDeleteHighlight,
  useGetStudySession,
  useGetUserPrefs,
  useListSegmentsByTrack,
  useSearchSegments,
  useListHighlightsBySession,
  useListGhostsBySession,
  useUpdateReadingProgress,
} from '../api/sessions-hooks'
import type { GhostCandidate } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { SelectionResult } from '../utils/selection-adapter'
import { normalizeCrossSegmentSelection } from '../utils/selection-adapter'
import { useWordSelection, wordKeyFromSpan } from '@/lib/dom/use-word-selection'
import { buildSegmentRanges, buildGhostSegmentRanges } from '../utils/build-segment-ranges'
import { findOverlappingGhost } from '../utils/ghost-overlap'
import { useVisibleSegmentRange } from '../hooks/use-visible-segment-range'
import { useSegmentPosition } from '../hooks/use-segment-position'
import { useGhostNomination } from '../hooks/use-ghost-nomination'
import { SegmentList, SegmentListSkeleton } from './segment-list'
import { TrackSearchBar } from './track-search-bar'
import { SessionGlossSheet, type ExistingHighlightInput } from './session-gloss-sheet'
import { SessionVocabularyFooter } from './session-vocabulary-footer'

const alignSegmentToBottom = (scrollContainer: HTMLElement, segmentId: string): boolean => {
  const target = scrollContainer.querySelector(`[data-segment-id="${segmentId}"]`)
  if (!target) return false
  const delta = target.getBoundingClientRect().bottom - scrollContainer.getBoundingClientRect().bottom
  scrollContainer.scrollTop += delta
  return true
}

export const SessionView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { sessionId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/' })
  const { segment: targetSegmentId, from } = useSearch({ from: '/_authenticated/_app/sessions/$sessionId/' })

  const { data: session, isLoading: isSessionLoading } = useGetStudySession(sessionId)
  const trackId = session?.textTrackId ?? null
  const [flashSegmentId, setFlashSegmentId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const isSearching = debouncedSearch.length > 0

  const { data: allSegments, isLoading: isSegmentsLoading } = useListSegmentsByTrack(trackId)
  const { data: searchSegments } = useSearchSegments(trackId, debouncedSearch, isSearching)
  const visibleSegments = isSearching ? (searchSegments ?? []) : (allSegments ?? [])

  const { data: highlights } = useListHighlightsBySession(sessionId)
  const { data: userPrefs } = useGetUserPrefs()
  // The entire ghost layer (nomination, fetch, outlines, "Use suggested") is gated
  // off when the user has disabled LLM suggestions — fully inert for them.
  const llmHighlightsEnabled = userPrefs?.llmHighlightsEnabled === true

  const rangesBySegmentId = useMemo(
    () => buildSegmentRanges(highlights ?? [], visibleSegments),
    [highlights, visibleSegments]
  )

  // Ghost candidates (passive LLM-suggested spans) + the nomination coverage set.
  const { data: ghostData } = useListGhostsBySession(sessionId, llmHighlightsEnabled)
  const ghostCandidates = useMemo(
    () => (llmHighlightsEnabled ? (ghostData?.candidates ?? []) : []),
    [llmHighlightsEnabled, ghostData]
  )
  const ghostRangesBySegmentId = useMemo(() => buildGhostSegmentRanges(ghostCandidates), [ghostCandidates])

  // Reading-position → nomination. Indices are track-relative (segment.index), never
  // client array positions, so they stay valid under search filtering / future
  // virtualization. We drive off the FULL track, not the (search-filtered) visible
  // slice.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const indexBySegmentId = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of allSegments ?? []) map.set(s.id, s.index)
    return map
  }, [allSegments])
  const maxSegmentIndex = useMemo(() => {
    let max: number | null = null
    for (const s of allSegments ?? []) max = max === null || s.index > max ? s.index : max
    return max
  }, [allSegments])
  const furthestReadSegmentId = useMemo(() => {
    const index = session?.furthestReadSegmentIndex
    if (index == null) return null
    return allSegments?.find((s) => s.index === index)?.id ?? null
  }, [allSegments, session?.furthestReadSegmentIndex])
  const { shallowestIndex, deepestIndex } = useVisibleSegmentRange(scrollEl, indexBySegmentId)
  // While searching, the scroll container renders only the (filtered) search
  // results, so the deepest-visible segment jumps to an arbitrary match and would
  // nominate windows the reader never actually read. Gate nomination off until the
  // search is cleared and the full track is back in view.
  useGhostNomination({
    sessionId,
    deepestIndex,
    maxSegmentIndex,
    serverWindows: ghostData?.windows,
    enabled: llmHighlightsEnabled && !isSearching,
  })
  // True while a nominate job for a window OVERLAPPING the viewport is still
  // running (`status === 'pending'`). Scoped to on-screen text on purpose: a
  // pending lookahead window the reader hasn't reached yet won't change what
  // they're looking at, so flashing a "Finding suggestions…" loader for it
  // would be noise. Surfaced as a footer loader when relevant so the
  // multi-second wait on the visible band doesn't look broken.
  const isGeneratingCandidates =
    llmHighlightsEnabled &&
    shallowestIndex !== null &&
    deepestIndex !== null &&
    (ghostData?.windows ?? []).some(
      (w) => w.status === 'pending' && w.endIndex >= shallowestIndex && w.startIndex <= deepestIndex
    )

  // The floating sheet has one mode at a time. `selection` is a fresh
  // mouseup/touchend that hasn't been persisted yet; `existingHighlightId`
  // points to an already-saved row the user just tapped.
  const [glossOpen, setGlossOpen] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<SelectionResult | null>(null)
  // Set when the pending selection came from a pre-save ghost adoption (the
  // "Use suggested" tap in preview mode). Save sends it as `adoptedGhostId` so
  // the backend dismisses the ghost in the same transaction as the insert.
  const [pendingGhostId, setPendingGhostId] = useState<string | null>(null)
  const [existingHighlightId, setExistingHighlightId] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<FloatingSheetAnchor>(null)

  // Suppress the click that immediately follows a finished selection — without
  // this, releasing inside an existing highlight reopens the sheet for the wrong
  // target right after we set the pending selection.
  const lastSelectionAtRef = useRef(0)

  // Background per-highlight enrichment keeps the session `active` throughout —
  // there is no synchronous Process step to redirect to a /processing screen,
  // and session vocabulary is reachable while active. (Discovery runs as a background job.)

  // Scroll a segment to the center of the viewport and flash it briefly. Shared by
  // the deep-link (`?segment=`) restore and the "jump to last highlight" button.
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollToSegment = useCallback((segmentId: string) => {
    const el = document.querySelector(`[data-segment-id="${segmentId}"]`)
    if (el && 'scrollIntoView' in el) {
      ;(el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    setFlashSegmentId(segmentId)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashSegmentId(null), 1500)
  }, [])

  useEffect(() => () => (flashTimerRef.current ? clearTimeout(flashTimerRef.current) : undefined), [])

  useEffect(() => {
    if (!targetSegmentId) return
    if (!allSegments || allSegments.length === 0) return
    const raf = requestAnimationFrame(() => scrollToSegment(targetSegmentId))
    return () => cancelAnimationFrame(raf)
  }, [targetSegmentId, allSegments, scrollToSegment])

  // Persist the deepest segment the reader reaches (resume position), but only on a
  // normal read: never while searching (deepest-visible then reflects arbitrary
  // filtered matches) and never under a deep-link open (the "open source" jump from a
  // card / Vocabulary mustn't move the saved position). Monotonic + throttled: one
  // write per few seconds carrying the latest max, plus a best-effort flush on leave.
  const { mutate: updateReadingProgress } = useUpdateReadingProgress()
  const writtenMaxRef = useRef(-1)
  useEffect(() => {
    if (session?.furthestReadSegmentIndex != null) {
      writtenMaxRef.current = Math.max(writtenMaxRef.current, session.furthestReadSegmentIndex)
    }
  }, [session?.furthestReadSegmentIndex])

  // Resume-reading: on a normal open (no deep-link target), land the reader back at
  // their furthest-read segment with NO visible scroll. We position the container in
  // a layout effect — synchronously, before the browser paints — so the content
  // appears already parked there (the same trick the chat uses to open at the
  // bottom), rather than starting at the top and animating down. Runs once per mount.
  const didRestoreRef = useRef(false)
  useLayoutEffect(() => {
    if (didRestoreRef.current) return
    if (targetSegmentId) return // an explicit deep-link target wins over resume
    const el = scrollEl
    // Wait until both the container and the rows exist; this is our one shot.
    if (!el || !session || !allSegments || allSegments.length === 0) return
    // Consume the one-shot now, even if there's nothing to restore to — otherwise a
    // later optimistic cache bump (furthest null → a real value as the reader
    // scrolls) would re-trigger this effect and yank a reader of a fresh session.
    didRestoreRef.current = true
    if (!furthestReadSegmentId) return
    // Align the deepest-read line to the bottom of the viewport — reproduces the
    // frame the reader left on, with everything below it still unread. scrollTop is
    // clamped by the browser, so an early segment just lands at the top.
    alignSegmentToBottom(el, furthestReadSegmentId)
  }, [scrollEl, session, allSegments, targetSegmentId, furthestReadSegmentId])

  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingMaxRef = useRef<number | null>(null)
  const trackingEnabled = !isSearching && !targetSegmentId
  const flushReadingProgress = useCallback(() => {
    const toWrite = pendingMaxRef.current
    pendingMaxRef.current = null
    if (toWrite != null && toWrite > writtenMaxRef.current) {
      writtenMaxRef.current = toWrite
      updateReadingProgress({ sessionId, segmentIndex: toWrite })
    }
  }, [sessionId, updateReadingProgress])

  useEffect(() => {
    if (!trackingEnabled || deepestIndex == null) return
    if (deepestIndex <= writtenMaxRef.current) return
    pendingMaxRef.current = deepestIndex
    if (writeTimerRef.current) return // throttle: a trailing write is already queued
    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null
      flushReadingProgress()
    }, 3000)
  }, [deepestIndex, trackingEnabled, flushReadingProgress])

  useEffect(
    () => () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
      flushReadingProgress()
    },
    [flushReadingProgress]
  )

  // Offer a quick return to the furthest-read segment when the reader scrolls back
  // up to re-read. Suppressed while searching, since the list then renders only
  // filtered matches and the anchor row may be absent.
  const furthestReadPosition = useSegmentPosition(scrollEl, furthestReadSegmentId)
  const showJumpToLastRead = !isSearching && furthestReadSegmentId != null && furthestReadPosition === 'below'
  const jumpToLastRead = useCallback(() => {
    if (!scrollEl || !furthestReadSegmentId) return
    if (!alignSegmentToBottom(scrollEl, furthestReadSegmentId)) return
    setFlashSegmentId(furthestReadSegmentId)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashSegmentId(null), 1500)
  }, [furthestReadSegmentId, scrollEl])

  // Tap-to-select-word gesture. Replaces native browser selection: a single
  // click/tap selects a word, press-and-drag extends a range. The adapter maps
  // the two word endpoints to a SelectionResult and opens the floating gloss
  // sheet. Lifecycle is eager: the sheet itself creates the highlight row if
  // the selection doesn't match an existing one.
  const {
    ref: wordSelectionRef,
    clearPaint,
    paintOffsetRange,
  } = useWordSelection({
    // Let taps on existing highlights fall through to their onClick handler.
    isBlockedTarget: (el) => el.closest('[data-highlight-id]') != null,
    enableEdgeAutoScroll: true,
    onSelect: ({ anchor: anchorWord, end: endWord, rect }) => {
      lastSelectionAtRef.current = Date.now()
      const normalized = normalizeCrossSegmentSelection(anchorWord, endWord, visibleSegments)
      // Bail paths must clear the paint themselves — it persists past pointerup
      // (it shows what the open sheet refers to), so a selection that doesn't
      // open a sheet would otherwise strand it.
      if (!normalized || normalized.selectionText.length === 0) {
        clearPaint()
        return
      }
      // A new selection while the sheet is already open swaps its content in
      // place rather than closing + reopening (the gloss sheet's
      // ignoreOutsidePointerDownSelector keeps the tap from dismissing it, and
      // the gesture already repainted the new word).
      const sel: SelectionResult = { ...normalized, rect }
      setExistingHighlightId(null)
      setPendingSelection(sel)
      setPendingGhostId(null)
      setAnchor(sel.rect)
      setGlossOpen(true)
    },
  })

  // Right-click toggle (extension-overlay parity): on a bare word it saves
  // immediately — no left-click selection or sheet involved — and on an
  // already-saved highlight it removes it. Feedback is the span's yellow wash
  // appearing/disappearing; the sheet stays closed so a power user can chain
  // saves. While the sheet IS open, its own document-level right-click handler
  // owns the gesture (save in preview / remove in saved mode), so bail here.
  // Pointerdown (not contextmenu) for the same reason as the sheet: the
  // word-selection hook already suppresses the native menu, and acting on the
  // initial press keeps both handlers on one event.
  const { mutate: createHighlightFromRightClick } = useCreateHighlight(sessionId)
  const { mutate: deleteHighlightFromRightClick } = useDeleteHighlight(sessionId)
  // Offsets of right-click saves currently in flight: until the created row is
  // back in the list, the word has no `data-highlight-id` wrapper yet, so a
  // double right-click faster than the roundtrip would save it twice.
  const pendingRightClickSavesRef = useRef<Set<string>>(new Set())
  const handleRightClickToggle = (e: React.PointerEvent) => {
    if (e.button !== 2 || glossOpen) return
    const target = e.target instanceof Element ? e.target : null
    if (!target) return
    const highlightEl = target.closest('[data-highlight-id]')
    if (highlightEl instanceof HTMLElement && highlightEl.dataset.highlightId) {
      // An optimistic row isn't deletable yet (the server doesn't know its
      // temp id) — a second right-click mid-save would 404. Drop the gesture;
      // the row gets its real id when the create settles.
      if (isOptimisticHighlightId(highlightEl.dataset.highlightId)) return
      deleteHighlightFromRightClick({ sessionId, highlightId: highlightEl.dataset.highlightId })
      return
    }
    const span = target.closest('[data-word-start]')
    if (!span) return
    const key = wordKeyFromSpan(span)
    if (!key) return
    const normalized = normalizeCrossSegmentSelection(key, key, visibleSegments)
    if (!normalized || normalized.selectionText.length === 0) return
    const saveKey = `${normalized.startSegmentId}:${normalized.startOffset}:${normalized.endOffset}`
    if (pendingRightClickSavesRef.current.has(saveKey)) return
    pendingRightClickSavesRef.current.add(saveKey)
    createHighlightFromRightClick(
      {
        sessionId,
        startSegmentId: normalized.startSegmentId,
        endSegmentId: normalized.endSegmentId,
        startOffset: normalized.startOffset,
        endOffset: normalized.endOffset,
        selectionText: normalized.selectionText,
        note: null,
        presetTags: [],
      },
      { onSettled: () => pendingRightClickSavesRef.current.delete(saveKey) }
    )
  }

  const handleSegmentListClick = (e: React.MouseEvent) => {
    // Suppress the click that closes a freshly-completed selection.
    if (Date.now() - lastSelectionAtRef.current < 250) return
    const target = e.target instanceof Element ? e.target.closest('[data-highlight-id]') : null
    if (!(target instanceof HTMLElement) || !target.dataset.highlightId) return
    // The sheet's saved mode fires fastGloss/note/delete against the id —
    // none of which exist for an optimistic row. Ignore the click until the
    // create settles and the span re-renders with its real id.
    if (isOptimisticHighlightId(target.dataset.highlightId)) return
    const match = highlights?.find((h) => h.id === target.dataset.highlightId)
    if (!match) return
    // Switching to a saved highlight while the sheet is open: drop any lingering
    // blue selection paint from the previous preview word (the highlight shows
    // its own yellow wash; the gesture didn't run to clear it here).
    clearPaint()
    const startSegment = visibleSegments.find((s) => s.id === match.startSegmentId)
    setPendingSelection({
      startSegmentId: match.startSegmentId,
      endSegmentId: match.endSegmentId,
      startOffset: match.startOffset,
      endOffset: match.endOffset,
      selectionText: match.selectionText,
      contextLine: startSegment?.text ?? match.selectionText,
      rect: target.getBoundingClientRect(),
    })
    setPendingGhostId(null)
    setExistingHighlightId(match.id)
    setAnchor(target.getBoundingClientRect())
    setGlossOpen(true)
  }

  const existingHighlight: ExistingHighlightInput | null = useMemo(() => {
    if (!existingHighlightId) return null
    const match = highlights?.find((h) => h.id === existingHighlightId)
    if (!match) return null
    return {
      id: match.id,
      selectionText: match.selectionText,
      note: match.note,
      presetTags: match.presetTags,
      fastGloss: match.fastGloss,
    }
  }, [existingHighlightId, highlights])

  // When a committed selection overlaps a ghost, the gloss sheet offers to adopt the
  // LLM's span. Suppressed entirely when LLM suggestions are off.
  const suggestedGhost = useMemo(() => {
    if (!llmHighlightsEnabled || !pendingSelection) return null
    return findOverlappingGhost(pendingSelection, ghostCandidates, visibleSegments)
  }, [llmHighlightsEnabled, pendingSelection, ghostCandidates, visibleSegments])

  // Pre-save ghost adoption: swap the LOCAL selection to the ghost's span — no
  // highlight exists yet, so there is nothing to switch server-side. The sheet
  // refetches its stateless gloss off the new selection (and the exact-match
  // suppression in findOverlappingGhost hides the suggestion, which the
  // selection now equals); Save then sends `adoptedGhostId`. The anchor rect is
  // kept so the sheet doesn't jump under the tap.
  const handleAdoptGhostPreSave = (ghost: GhostCandidate) => {
    const segment = visibleSegments.find((s) => s.id === ghost.segmentId)
    if (!segment || !pendingSelection) return
    setPendingGhostId(ghost.id)
    setPendingSelection({
      startSegmentId: ghost.segmentId,
      endSegmentId: ghost.segmentId,
      startOffset: ghost.charStart,
      endOffset: ghost.charEnd,
      selectionText: ghost.surfaceForm,
      contextLine: segment.text,
      rect: pendingSelection.rect,
    })
    // Expand the blue selection paint from the single tapped word to the full
    // adopted span so the text matches what the sheet now refers to.
    paintOffsetRange(ghost.segmentId, ghost.charStart, ghost.charEnd)
  }

  const closeToSessions = () => {
    if (from === 'vocabulary') {
      void navigate({ to: '/vocabulary' })
      return
    }
    void navigate({ to: '/sessions' })
  }

  if (isSessionLoading) {
    // Mirror the loaded reader (title + search bar + segment list) with
    // skeletons rather than a bare full-view spinner, so the chrome is stable
    // from the first paint.
    const titleSkeleton = (
      <span className='flex min-w-0 flex-col gap-1.5'>
        <Skeleton className='h-4 w-40' />
        <Skeleton className='h-3 w-20' />
      </span>
    )
    return (
      <ModalScreen onClose={closeToSessions} title={titleSkeleton}>
        <div className='bg-background border-b px-4 py-3'>
          <div className='mx-auto max-w-4xl'>
            <Skeleton className='h-10 w-full rounded-md' />
          </div>
        </div>
        <div className='flex-1 overflow-y-auto px-4 py-3'>
          <div className='mx-auto max-w-4xl'>
            <SegmentListSkeleton />
          </div>
        </div>
      </ModalScreen>
    )
  }
  if (!session) {
    return (
      <ModalScreen onClose={closeToSessions} title={t`Session`}>
        <div className='text-muted-foreground mx-auto max-w-4xl px-4 py-6 text-sm'>{t`Session not found.`}</div>
      </ModalScreen>
    )
  }

  const sourceTitle = session.contentSourceTitle ?? t`Untitled`
  const titleNode = (
    <span className='flex min-w-0 flex-col leading-tight'>
      <span className='truncate text-base font-semibold'>
        {sourceTitle}
        {session.contentSourceYear ? ` (${session.contentSourceYear})` : ''}
      </span>
      <span className='text-muted-foreground truncate text-xs font-normal'>
        {session.targetLanguage.toUpperCase()} · {session.cefrLevel}
      </span>
    </span>
  )

  return (
    <ModalScreen onClose={closeToSessions} title={titleNode}>
      <div className='bg-background border-b px-4 py-3'>
        <div className='mx-auto max-w-4xl'>
          <TrackSearchBar value={search} onChange={setSearch} />
        </div>
      </div>

      <div className='relative flex min-h-0 flex-1 flex-col'>
        <div
          ref={(el) => {
            // One scroll container, two consumers: the word-selection gesture and the
            // IntersectionObserver behind reading-position nomination.
            wordSelectionRef(el)
            setScrollEl(el)
          }}
          className='flex-1 touch-pan-y overflow-y-auto px-4 py-3 select-none'
          style={{ WebkitTouchCallout: 'none' }}
          onClick={handleSegmentListClick}
          onPointerDown={handleRightClickToggle}
        >
          <div className='mx-auto max-w-4xl'>
            {isSegmentsLoading ? (
              <SegmentListSkeleton />
            ) : (
              <SegmentList
                segments={visibleSegments}
                rangesBySegmentId={rangesBySegmentId}
                ghostRangesBySegmentId={ghostRangesBySegmentId}
                targetLanguage={session.targetLanguage}
                flashSegmentId={flashSegmentId}
              />
            )}
          </div>
        </div>
        {showJumpToLastRead && (
          <Button
            type='button'
            variant='secondary'
            size='sm'
            onClick={jumpToLastRead}
            className='absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border shadow-md'
          >
            <ChevronDown className='h-4 w-4' />
            {t`Last read`}
          </Button>
        )}
      </div>

      <SessionVocabularyFooter
        sessionId={sessionId}
        highlightCount={highlights?.length ?? 0}
        isGeneratingCandidates={isGeneratingCandidates}
        onOpenSessionVocabulary={() => {
          void navigate({ to: '/sessions/$sessionId/review', params: { sessionId } })
        }}
      />

      <SessionGlossSheet
        open={glossOpen}
        sessionId={sessionId}
        targetLanguage={session.targetLanguage}
        selection={pendingSelection}
        existingHighlight={existingHighlight}
        suggestedGhost={suggestedGhost}
        pendingGhostId={pendingGhostId}
        onAdoptGhostPreSave={handleAdoptGhostPreSave}
        anchor={anchor}
        onClose={() => {
          // Keep `anchor`, `pendingSelection`, `existingHighlightId` in state
          // so the popover's closing animation still has its rect / data to
          // render against. They'll be overwritten on the next open.
          setGlossOpen(false)
          // Drop any sky paint so a back-navigation doesn't strand it.
          clearPaint()
        }}
      />
    </ModalScreen>
  )
}
