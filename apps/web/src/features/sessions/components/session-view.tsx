import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { toast } from 'sonner'
import { ORPCError } from '@orpc/contract'
import { Bookmark, ChevronDown } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import type { FloatingSheetAnchor } from '@flicktionary/ui/components/floating-sheet'
import { useDebouncedValue } from '../hooks/use-debounced-value'
import {
  isOptimisticHighlightId,
  useCheckpointClaims,
  useCheckpointPreview,
  useCollectCheckpoint,
  useCreateHighlight,
  useDeleteHighlight,
  useGetStudySession,
  useGetUserPrefs,
  useListSegmentsByTrack,
  useSearchSegments,
  useListHighlightsBySession,
  useListGhostsBySession,
  useMarkKnownPreview,
  useMarkRemainingKnown,
  useSessionDifficulties,
  useSetReadingPosition,
  useUndoCheckpoint,
  useUnmarkKnownBySession,
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
import { formatTimestamp } from '../utils/format-timestamp'
import { WelcomeBackCard } from './welcome-back-card'
import { TrackSearchBar } from './track-search-bar'
import { SessionGlossSheet, type ExistingHighlightInput } from './session-gloss-sheet'
import { SessionVocabularyFooter } from './session-vocabulary-footer'
import { CheckpointClaimsSheet, type CheckpointBacklogCandidate } from './checkpoint-claims-sheet'
import { CheckpointCloseoutCard } from './checkpoint-closeout-card'
import { SessionDifficultySheet } from './session-difficulty-sheet'
import { SessionDifficultyStat } from './session-difficulty-stat'
import { getSavedVocabularySearch } from '@/features/vocabulary/saved-search'

// Unprompted sweep offers (the footer dock now, the welcome-back card later)
// hold back until this many unswept read words exist — no greeting the reader
// over a handful of words.
const MARK_KNOWN_OFFER_FLOOR = 20

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

  // --- Manual reading-position bookmark (the "read up to here" divider) --------
  // Placement mode: taps place the divider instead of glossing/selecting, and a
  // sticky footer confirms with an explicit (possibly backward) set. After a
  // set, `autoTrackPin` suspends auto-advance until the viewport scrolls back
  // up to the pin — the natural "re-read from here" gesture — because the
  // deeper lines still on screen would otherwise re-advance the pointer past
  // the correction on the next scroll tick. The pin is session-state only: a
  // remount resumes at the pin, so tracking re-engages naturally next sitting.
  const [isPlacingBookmark, setIsPlacingBookmark] = useState(false)
  const [placementIndex, setPlacementIndex] = useState<number | null>(null)
  // Mirrors for the tracking effect and the word-selection callback — neither
  // the mode nor the pin drives a render from inside them.
  const isPlacingBookmarkRef = useRef(false)
  const autoTrackPinRef = useRef<number | null>(null)
  const { mutate: setReadingPosition, isPending: isSettingPosition } = useSetReadingPosition(sessionId)
  const placementSegmentId = useMemo(() => {
    if (placementIndex == null) return null
    return allSegments?.find((s) => s.index === placementIndex)?.id ?? null
  }, [allSegments, placementIndex])

  useEffect(() => {
    if (!trackingEnabled || deepestIndex == null) return
    // The pin releases once the viewport is back up at it — the natural
    // "re-read from here" gesture after a manual set.
    if (autoTrackPinRef.current != null && shallowestIndex != null && shallowestIndex <= autoTrackPinRef.current) {
      autoTrackPinRef.current = null
    }
    // Suspended while placing (browsing for a line isn't reading) and while
    // the pin holds.
    if (isPlacingBookmarkRef.current || autoTrackPinRef.current != null) return
    if (deepestIndex <= writtenMaxRef.current) return
    pendingMaxRef.current = deepestIndex
    if (writeTimerRef.current) return // throttle: a trailing write is already queued
    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null
      flushReadingProgress()
    }, 3000)
  }, [deepestIndex, shallowestIndex, trackingEnabled, flushReadingProgress])

  useEffect(
    () => () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
      flushReadingProgress()
    },
    [flushReadingProgress]
  )

  // --- Checkpoint reviews (docs/READER-SPEC.md) --------------------------------
  // Hard language gate: no wiktionary data → no checkpoint affordances at all.
  const checkpointSupported = session != null && KAIKKI_LANGUAGES.has(session.targetLanguage)

  // Preview-glossed spans, tracked client-side (the stateless gloss endpoint
  // persists nothing): sent with the collect call so glossed terms are
  // suppressed rather than credited. Deliberately NOT cleared on checkpoint
  // undo — a re-collection must stay suppressed. Capped to the contract's
  // maxes (500 spans, 200 chars each — one over-long selection would
  // otherwise fail validation on EVERY later collect). Truncation only
  // weakens suppression for the cut tail, which errs in the safe direction
  // (suppress-not-credit).
  const previewedSpansRef = useRef<Array<{ segmentIndex: number; selectionText: string }>>([])
  const recordPreviewedSpan = useCallback(
    (segmentId: string, selectionText: string) => {
      const segmentIndex = indexBySegmentId.get(segmentId)
      if (segmentIndex == null) return
      previewedSpansRef.current.push({ segmentIndex, selectionText: selectionText.slice(0, 200) })
      if (previewedSpansRef.current.length > 500) {
        previewedSpansRef.current = previewedSpansRef.current.slice(-500)
      }
    },
    [indexBySegmentId]
  )

  // The checkpoint anchors to the furthest-READ pointer, never the viewport —
  // "everything I've read so far" holds even after scrolling back up. Debounce
  // the INPUT (not just the query): every raw index change would otherwise
  // mint a new preview query key per scrolled segment.
  const furthestReadIndex = session?.furthestReadSegmentIndex ?? null
  const reviewedUntilIndex = session?.reviewedUntilSegmentIndex ?? null
  const debouncedFurthestIndex = useDebouncedValue(furthestReadIndex, 6000)
  const checkpointSpanNonEmpty = debouncedFurthestIndex != null && debouncedFurthestIndex > (reviewedUntilIndex ?? -1)
  const { data: checkpointPreview } = useCheckpointPreview(
    sessionId,
    checkpointSupported && checkpointSpanNonEmpty ? debouncedFurthestIndex : null
  )
  const checkpointPendingCount = checkpointPreview?.pendingCount ?? 0
  const checkpointBacklogCount = checkpointPreview?.backlogCount ?? 0

  const { mutate: collectCheckpoint, isPending: isCollectingCheckpoint } = useCollectCheckpoint(sessionId)
  const { mutate: undoCheckpoint } = useUndoCheckpoint(sessionId)
  // The claims sheet's data (backlog candidates) has two sources. Local state
  // holds the batch from this mount's collect/assert/undo actions; while it is
  // null (no local action yet), the server-rehydrated copy below fills in so a
  // reload or navigation can't strand the re-entry — the candidates persist on
  // the checkpoint row. `{ value: null }` is distinct from null: a locally
  // exhausted batch (asserted, or its checkpoint undone) must suppress the
  // server copy until the invalidated query catches up.
  const [localClaims, setLocalClaims] = useState<{
    value: { checkpointId: string; candidates: CheckpointBacklogCandidate[] } | null
  } | null>(null)
  const [claimsOpen, setClaimsOpen] = useState(false)
  const { data: serverClaims } = useCheckpointClaims(sessionId, checkpointSupported)
  // The header's difficulty stat + its detail sheet (breakdown, mark-known CTA).
  const [difficultyOpen, setDifficultyOpen] = useState(false)
  const { difficulties } = useSessionDifficulties(useMemo(() => [sessionId], [sessionId]))
  const sessionDifficulty = difficulties[sessionId]
  // Checkpoints reverted this mount: an assertion-undo must not restore a
  // claims batch for a dead checkpoint (its re-assert would 404), and the
  // server-rehydrated claims may still name it until the refetch lands.
  const revertedCheckpointIdsRef = useRef<Set<string>>(new Set())

  // --- Mark-known sweep surfaces (dock line + close-out rider) -----------------
  // Counts only ever cover words actually read: the read span mid-text, the
  // whole text once the reader reached the end, nothing on a never-scrolled
  // session. Keyed on the checkpoint preview's debounced pointer (a raw index
  // would mint a new preview query key per scrolled segment), with a raw
  // fallback so the first fetch doesn't wait out the debounce window on open.
  // Gated on an available profile: these are passive offers and must never be
  // the thing that polls a pending build.
  const markKnownSupported = sessionDifficulty?.status === 'available'
  const markKnownSpanIndex = debouncedFurthestIndex ?? furthestReadIndex
  const hasPartialRead = markKnownSpanIndex != null && maxSegmentIndex != null && markKnownSpanIndex < maxSegmentIndex
  const isReadToEnd = furthestReadIndex != null && maxSegmentIndex != null && furthestReadIndex >= maxSegmentIndex
  const spanMarkKnownQuery = useMarkKnownPreview(sessionId, markKnownSupported && hasPartialRead, markKnownSpanIndex)
  const wholeMarkKnownQuery = useMarkKnownPreview(sessionId, markKnownSupported && isReadToEnd)
  const spanMarkKnownCount =
    spanMarkKnownQuery.data?.status === 'ready' ? spanMarkKnownQuery.data.markableLemmaCount : 0
  const wholeMarkKnownCount =
    wholeMarkKnownQuery.data?.status === 'ready' ? wholeMarkKnownQuery.data.markableLemmaCount : 0
  // --- Welcome-back offer (once per mount) -------------------------------------
  // Snapshot the pointer the mount opened with: the card refers to LAST
  // sitting's span, so its anchor and count never follow the live pointer as
  // the reader reads on. Write-once render snapshot (undefined = session not
  // loaded yet).
  const welcomeAnchorIndexRef = useRef<number | null | undefined>(undefined)
  if (welcomeAnchorIndexRef.current === undefined && session) {
    welcomeAnchorIndexRef.current = session.furthestReadSegmentIndex ?? null
  }
  const welcomeAnchorIndex = welcomeAnchorIndexRef.current ?? null
  // The divider marks a RESTING boundary only: where this sitting opened, or
  // where a manual set placed it. Once the reader reads past it the pointer
  // advances beyond the anchor and the divider disappears for the rest of the
  // sitting — a marker chasing the live reading edge would shift content under
  // the thumb on every throttled progress write. Next mount it rests at the
  // new frontier.
  const restingDividerIndexRef = useRef<number | null | undefined>(undefined)
  if (restingDividerIndexRef.current === undefined && session) {
    restingDividerIndexRef.current = session.furthestReadSegmentIndex ?? null
  }
  const showRestingDivider =
    restingDividerIndexRef.current != null && furthestReadIndex === restingDividerIndexRef.current
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  // Suppressed on deep-link opens: following a word into the text isn't
  // "returning to read".
  const welcomeEligible =
    !welcomeDismissed &&
    !targetSegmentId &&
    welcomeAnchorIndex != null &&
    maxSegmentIndex != null &&
    welcomeAnchorIndex < maxSegmentIndex
  const welcomeQuery = useMarkKnownPreview(sessionId, markKnownSupported && welcomeEligible, welcomeAnchorIndex)
  const welcomeCount =
    welcomeEligible && welcomeQuery.data?.status === 'ready' ? welcomeQuery.data.markableLemmaCount : 0
  const showWelcomeCard = welcomeCount >= MARK_KNOWN_OFFER_FLOOR
  const welcomeAnchorSegment = useMemo(() => {
    if (welcomeAnchorIndex == null) return null
    return allSegments?.find((s) => s.index === welcomeAnchorIndex) ?? null
  }, [allSegments, welcomeAnchorIndex])

  // The dock is an unprompted offer, so it holds back until the count clears
  // the floor, and stands down while the welcome-back card is on screen (the
  // offer never appears twice at once); the close-out rider is a surface the
  // reader deliberately reached and shows any non-zero count. Read-to-end
  // sessions get no dock — the close-out card owns the offer there.
  const markKnownDockCount =
    !showWelcomeCard && hasPartialRead && spanMarkKnownCount >= MARK_KNOWN_OFFER_FLOOR ? spanMarkKnownCount : 0

  const { mutate: markRemainingKnown, isPending: isMarkingKnown } = useMarkRemainingKnown(sessionId)
  const { mutate: unmarkKnownBySession } = useUnmarkKnownBySession(sessionId)
  // Post-sweep feedback lives in the footer slot (not a toast): the count plus
  // a sweep-scoped Undo, cleared after a few seconds. The difficulty sheet
  // keeps its own toast — this strip only serves the reader-surface sweeps.
  const [sweepConfirmation, setSweepConfirmation] = useState<{ count: number; sweepBatchId: string | null } | null>(
    null
  )
  const sweepConfirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => (sweepConfirmationTimerRef.current ? clearTimeout(sweepConfirmationTimerRef.current) : undefined),
    []
  )
  const handleMarkKnown = (toSegmentIndex: number | null) => {
    if (isMarkingKnown) return
    markRemainingKnown(
      { sessionId, ...(toSegmentIndex != null ? { toSegmentIndex } : {}) },
      {
        onSuccess: (response) => {
          setSweepConfirmation({ count: response.data.markedCount, sweepBatchId: response.data.sweepBatchId })
          if (sweepConfirmationTimerRef.current) clearTimeout(sweepConfirmationTimerRef.current)
          sweepConfirmationTimerRef.current = setTimeout(() => {
            sweepConfirmationTimerRef.current = null
            setSweepConfirmation(null)
          }, 8000)
        },
      }
    )
  }
  const handleUndoSweep = () => {
    // Sweep-exact: the batch id scopes the delete to exactly the confirmed
    // press, so undoing sweep 2 never takes sweep 1's marks with it.
    const sweepBatchId = sweepConfirmation?.sweepBatchId
    if (sweepBatchId) unmarkKnownBySession({ sessionId, sweepBatchId })
    if (sweepConfirmationTimerRef.current) clearTimeout(sweepConfirmationTimerRef.current)
    sweepConfirmationTimerRef.current = null
    setSweepConfirmation(null)
  }

  const claims = localClaims
    ? localClaims.value
    : serverClaims?.checkpointId != null &&
        serverClaims.candidates.length > 0 &&
        !revertedCheckpointIdsRef.current.has(serverClaims.checkpointId)
      ? { checkpointId: serverClaims.checkpointId, candidates: serverClaims.candidates }
      : null

  const handleCollectCheckpoint = () => {
    const toIndex = session?.furthestReadSegmentIndex
    if (toIndex == null || isCollectingCheckpoint) return
    collectCheckpoint(
      { sessionId, toSegmentIndex: toIndex, previewedSpans: previewedSpansRef.current.slice(-500) },
      {
        onSuccess: ({ data }) => {
          if (data.checkpointId && data.creditedCount > 0) {
            const checkpointId = data.checkpointId
            const collectedCount = data.creditedCount
            toast.success(plural(collectedCount, { one: '# review collected', other: '# reviews collected' }), {
              action: {
                label: t`Undo`,
                // A reverted checkpoint can't accept assertions anymore, so a
                // successful undo must also drop this checkpoint's claims
                // re-entry (close-out card + sheet) — confirming from it
                // would 404 against the dead checkpoint.
                onClick: () =>
                  undoCheckpoint(
                    { sessionId, checkpointId },
                    {
                      onSuccess: ({ data }) => {
                        if (!data.undone) return
                        revertedCheckpointIdsRef.current.add(checkpointId)
                        setClaimsOpen(false)
                        setLocalClaims((prev) => (prev?.value?.checkpointId === checkpointId ? { value: null } : prev))
                      },
                    }
                  ),
              },
            })
          }
          if (data.checkpointId && data.backlogCandidates.length > 0) {
            setLocalClaims({ value: { checkpointId: data.checkpointId, candidates: data.backlogCandidates } })
            setClaimsOpen(true)
          }
        },
        onError: (error) => {
          // A concurrent press (another tab / the extension) advanced the
          // pointer first. meta.invalidates already refetched the session and
          // preview on settle, so a retry presses against fresh state.
          if (error instanceof ORPCError && error.code === 'CONFLICT') {
            toast.error(t`Your reading position changed — try again`, {
              action: { label: t`Retry`, onClick: () => handleCollectCheckpoint() },
            })
            return
          }
          toast.error(t`Failed to collect reviews`)
        },
      }
    )
  }

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
      // Placement mode owns the gesture. Word presses must place the divider
      // HERE, not in the click handler: the hook pointer-captures them, and
      // with capture active desktop Chrome retargets the ensuing click to the
      // scroll container, where closest('[data-segment-id]') finds nothing.
      // (Non-word taps — timestamps, padding — skip capture and still place
      // via handleSegmentListClick; on touch both paths fire, idempotently.)
      if (isPlacingBookmarkRef.current) {
        clearPaint()
        const index = indexBySegmentId.get(endWord.ownerKey)
        if (index != null) setPlacementIndex(index)
        return
      }
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
      // A fresh selection opens the sheet in preview mode, which fires the
      // stateless gloss — record the span for checkpoint suppression.
      recordPreviewedSpan(normalized.startSegmentId, normalized.selectionText)
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
    if (e.button !== 2 || glossOpen || isPlacingBookmark) return
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
    // Placement mode: any tap on a line moves the divider preview there.
    // Track-relative indices, so this works in the search-filtered list too
    // ("search the last line you remember, tap it").
    if (isPlacingBookmark) {
      const row = e.target instanceof Element ? e.target.closest('[data-segment-id]') : null
      if (row instanceof HTMLElement && row.dataset.segmentId) {
        const index = indexBySegmentId.get(row.dataset.segmentId)
        if (index != null) setPlacementIndex(index)
      }
      return
    }
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
    // The sheet re-glosses the adopted span — record it for suppression too.
    recordPreviewedSpan(ghost.segmentId, ghost.surfaceForm)
  }

  const enterBookmarkPlacement = () => {
    // The mode owns taps — close the gloss sheet and drop any selection paint.
    setGlossOpen(false)
    clearPaint()
    setPlacementIndex(furthestReadIndex)
    setIsPlacingBookmark(true)
    isPlacingBookmarkRef.current = true
  }

  const cancelBookmarkPlacement = () => {
    setIsPlacingBookmark(false)
    isPlacingBookmarkRef.current = false
    // Browsing around during placement isn't reading: pin auto-advance to the
    // unchanged pointer (top of the track for a never-read session) so the
    // deepest line merely *seen* while hunting doesn't get written.
    autoTrackPinRef.current = furthestReadIndex ?? 0
  }

  const confirmBookmarkPlacement = () => {
    if (placementIndex == null || isSettingPosition) return
    // Drop any queued throttled advance — flushed after the set, the server's
    // GREATEST would immediately raise the pointer back over the correction.
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current)
      writeTimerRef.current = null
    }
    pendingMaxRef.current = null
    writtenMaxRef.current = placementIndex
    setReadingPosition({ sessionId, segmentIndex: placementIndex })
    setIsPlacingBookmark(false)
    isPlacingBookmarkRef.current = false
    autoTrackPinRef.current = placementIndex
    // A manual set is the new resting boundary — the divider stays put there
    // until the reader reads past it.
    restingDividerIndexRef.current = placementIndex
  }

  const closeToSessions = () => {
    if (from === 'vocabulary') {
      // Restore the sort/filter state the user was browsing under (same as the
      // focus view's back), so an Open-source detour doesn't reset the list.
      void navigate({ to: '/vocabulary', search: getSavedVocabularySearch() })
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

  // Where the divider renders: the pending preview while placing (visible even
  // in the search-filtered list, if its row is), else the resting boundary on
  // a normal (unfiltered) read — never the live, advancing pointer.
  const readPositionSegmentId = isPlacingBookmark
    ? placementSegmentId
    : isSearching || !showRestingDivider
      ? null
      : furthestReadSegmentId

  const sourceTitle = session.contentSourceTitle ?? t`Untitled`
  const titleNode = (
    <span className='flex min-w-0 flex-col leading-tight'>
      <span className='truncate text-base font-semibold'>
        {sourceTitle}
        {session.contentSourceYear ? ` (${session.contentSourceYear})` : ''}
      </span>
      <span className='text-muted-foreground truncate text-xs font-normal'>
        {session.targetLanguage.toUpperCase()} · {session.cefrLevel}
        {sessionDifficulty && sessionDifficulty.status !== 'unsupported' && sessionDifficulty.status !== 'failed' && (
          <button
            type='button'
            className='hover:text-foreground cursor-pointer underline-offset-2 hover:underline'
            onClick={() => setDifficultyOpen(true)}
          >
            <SessionDifficultyStat difficulty={sessionDifficulty} prefix=' · ' />
          </button>
        )}
        {/* The session's highlight count, tappable through to the vocabulary
            list — the header owns this stat (the footer stays action-only). */}
        <button
          type='button'
          className='hover:text-foreground cursor-pointer underline-offset-2 hover:underline'
          onClick={() => void navigate({ to: '/sessions/$sessionId/review', params: { sessionId } })}
        >
          {' · '}
          {plural(highlights?.length ?? 0, { one: '# highlight', other: '# highlights' })}
        </button>
      </span>
    </span>
  )

  return (
    <ModalScreen
      onClose={closeToSessions}
      title={titleNode}
      rightSlot={
        allSegments && allSegments.length > 0 ? (
          <Button
            variant={isPlacingBookmark ? 'secondary' : 'ghost'}
            size='icon'
            aria-label={t`Set reading position`}
            aria-pressed={isPlacingBookmark}
            onClick={() => (isPlacingBookmark ? cancelBookmarkPlacement() : enterBookmarkPlacement())}
          >
            <Bookmark className='size-5' />
          </Button>
        ) : undefined
      }
    >
      {/* Coverage meter: solid fill = current expected coverage, animating on
          sweeps as the payoff. The read-but-unclaimed striped tail needs a
          projected-coverage number from the backend — shelved, see
          docs/proposals/mark-known-projected-coverage.md. */}
      {sessionDifficulty?.status === 'available' && sessionDifficulty.expectedCoveragePercent != null && (
        <div className='bg-muted h-[3px] shrink-0'>
          <div
            className='bg-primary/60 h-full transition-[width] duration-700'
            style={{ width: `${sessionDifficulty.expectedCoveragePercent}%` }}
          />
        </div>
      )}
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
              <>
                <SegmentList
                  segments={visibleSegments}
                  rangesBySegmentId={rangesBySegmentId}
                  ghostRangesBySegmentId={ghostRangesBySegmentId}
                  targetLanguage={session.targetLanguage}
                  flashSegmentId={flashSegmentId}
                  readPositionSegmentId={readPositionSegmentId}
                  readPositionVariant={isPlacingBookmark ? 'placing' : 'set'}
                  welcomeCardSegmentId={
                    showWelcomeCard && !isSearching && welcomeAnchorSegment ? welcomeAnchorSegment.id : null
                  }
                  welcomeCard={
                    welcomeAnchorSegment ? (
                      <WelcomeBackCard
                        count={welcomeCount}
                        untilLabel={formatTimestamp(welcomeAnchorSegment.startMs) || null}
                        isMarking={isMarkingKnown}
                        onMarkKnown={() => {
                          setWelcomeDismissed(true)
                          handleMarkKnown(welcomeAnchorIndex)
                        }}
                        onDismiss={() => setWelcomeDismissed(true)}
                      />
                    ) : undefined
                  }
                />
                {/* End-of-content close-out: the common case is finishing the
                    text — offer the checkpoint press with a fuller
                    presentation once the reader has actually reached the last
                    segment. Hidden while searching (the filtered list isn't
                    "the end"). */}
                {checkpointSupported &&
                  !isSearching &&
                  maxSegmentIndex != null &&
                  furthestReadIndex != null &&
                  furthestReadIndex >= maxSegmentIndex && (
                    <CheckpointCloseoutCard
                      pendingCount={checkpointPendingCount}
                      isCollected={(reviewedUntilIndex ?? -1) >= maxSegmentIndex}
                      isCollecting={isCollectingCheckpoint}
                      onCollect={handleCollectCheckpoint}
                      claimsCount={claims?.candidates.length ?? 0}
                      onOpenClaims={() => setClaimsOpen(true)}
                      markKnownCount={wholeMarkKnownCount}
                      isMarkingKnown={isMarkingKnown}
                      onMarkKnown={() => handleMarkKnown(null)}
                    />
                  )}
              </>
            )}
          </div>
        </div>
        {showJumpToLastRead && !isPlacingBookmark && (
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

      {isPlacingBookmark ? (
        // Placement mode takes over the footer: instruction + cancel/confirm,
        // mirroring the vocabulary footer's chrome so the swap doesn't jump.
        <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t p-3 backdrop-blur'>
          <div className='mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3'>
            <span className='text-muted-foreground text-sm'>{t`Tap the last line you've read.`}</span>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
              <Button size='xl' variant='outline' className='w-full sm:w-auto' onClick={cancelBookmarkPlacement}>
                {t`Cancel`}
              </Button>
              <Button
                size='xl'
                className='w-full sm:w-auto'
                disabled={placementIndex == null || isSettingPosition}
                onClick={confirmBookmarkPlacement}
              >
                {t`Set reading position`}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <SessionVocabularyFooter
          sessionId={sessionId}
          isGeneratingCandidates={isGeneratingCandidates}
          onOpenSessionVocabulary={() => {
            void navigate({ to: '/sessions/$sessionId/review', params: { sessionId } })
          }}
          checkpointPendingCount={checkpointPendingCount}
          checkpointBacklogCount={checkpointBacklogCount}
          onCollectCheckpoint={checkpointSupported ? handleCollectCheckpoint : undefined}
          isCollectingCheckpoint={isCollectingCheckpoint}
          markKnownDockCount={markKnownDockCount}
          onMarkKnown={() => handleMarkKnown(markKnownSpanIndex)}
          isMarkingKnown={isMarkingKnown}
          sweepConfirmation={
            sweepConfirmation
              ? { count: sweepConfirmation.count, onUndo: sweepConfirmation.sweepBatchId ? handleUndoSweep : null }
              : null
          }
        />
      )}

      <SessionDifficultySheet
        open={difficultyOpen}
        onOpenChange={setDifficultyOpen}
        sessionId={sessionId}
        difficulty={sessionDifficulty}
        furthestReadSegmentIndex={furthestReadIndex}
        maxSegmentIndex={maxSegmentIndex}
      />

      <CheckpointClaimsSheet
        open={claimsOpen}
        onOpenChange={setClaimsOpen}
        sessionId={sessionId}
        checkpointId={claims?.checkpointId ?? null}
        candidates={claims?.candidates ?? []}
        onAsserted={() => setLocalClaims({ value: null })}
        // Restore the re-entry on assertion undo — but never clobber a newer
        // collect's batch that replaced it, and never resurrect a batch whose
        // checkpoint was reverted in the meantime.
        onAssertUndone={(restored) => {
          if (revertedCheckpointIdsRef.current.has(restored.checkpointId)) return
          setLocalClaims((prev) => (prev?.value ? prev : { value: restored }))
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
