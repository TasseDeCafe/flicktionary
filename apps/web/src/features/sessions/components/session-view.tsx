import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { ListChecks } from 'lucide-react'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import type { FloatingSheetAnchor } from '@/components/ui/floating-sheet'
import { useDebouncedValue } from '../hooks/use-debounced-value'
import {
  useGetStudySession,
  useListSegmentsByTrack,
  useSearchSegments,
  useListHighlightsBySession,
} from '../api/sessions-hooks'
import { useListCardsBySession } from '@/features/review/api/review-hooks'
import { readCurrentSelection, SelectionResult } from '../hooks/use-text-selection'
import { buildSegmentRanges } from '../utils/build-segment-ranges'
import { SegmentList } from './segment-list'
import { TrackSearchBar } from './track-search-bar'
import { SessionGlossSheet, type ExistingHighlightInput } from './session-gloss-sheet'
import { ProcessButton } from './process-button'

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
  const { data: cards } = useListCardsBySession(sessionId)
  const rangesBySegmentId = useMemo(
    () => buildSegmentRanges(highlights ?? [], visibleSegments),
    [highlights, visibleSegments]
  )
  const unprocessedHighlightCount = useMemo(() => {
    if (!highlights) return 0
    const processed = new Set((cards ?? []).map((c) => c.highlightId).filter((id): id is string => !!id))
    return highlights.reduce((n, h) => (processed.has(h.id) ? n : n + 1), 0)
  }, [highlights, cards])

  // The floating sheet has one mode at a time. `selection` is a fresh
  // mouseup/touchend that hasn't been persisted yet; `existingHighlightId`
  // points to an already-saved row the user just tapped.
  const [glossOpen, setGlossOpen] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<SelectionResult | null>(null)
  const [existingHighlightId, setExistingHighlightId] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<FloatingSheetAnchor>(null)

  // Suppress the click that immediately follows a finished selection — without
  // this, releasing inside an existing highlight reopens the sheet for the wrong
  // target right after we set the pending selection.
  const lastSelectionAtRef = useRef(0)

  useEffect(() => {
    const status = session?.status
    if (status === 'processing' || status === 'failed') {
      void navigate({ to: '/sessions/$sessionId/processing', params: { sessionId }, replace: true })
    }
  }, [session?.status, sessionId, navigate])

  useEffect(() => {
    if (!targetSegmentId) return
    if (!allSegments || allSegments.length === 0) return
    let raf: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-segment-id="${targetSegmentId}"]`)
      if (el && 'scrollIntoView' in el) {
        ;(el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
      setFlashSegmentId(targetSegmentId)
      timer = setTimeout(() => setFlashSegmentId(null), 1500)
    })
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
      if (timer !== null) clearTimeout(timer)
    }
  }, [targetSegmentId, allSegments])

  // Selection finished → open the floating gloss sheet. Lifecycle is eager:
  // the sheet itself creates the highlight row if the selection doesn't match
  // an existing one. The tap-to-translate user pref was removed in favor of
  // this always-on (but non-modal) sheet.
  useEffect(() => {
    const handleEnd = () => {
      setTimeout(() => {
        const sel = readCurrentSelection()
        if (!sel) return
        lastSelectionAtRef.current = Date.now()
        if (glossOpen) return
        setExistingHighlightId(null)
        setPendingSelection(sel)
        setAnchor(sel.rect)
        setGlossOpen(true)
        window.getSelection()?.removeAllRanges()
      }, 30)
    }
    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('touchend', handleEnd)
    return () => {
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('touchend', handleEnd)
    }
  }, [glossOpen])

  const isProcessedOrExported = session?.status === 'processed' || session?.status === 'exported'

  const handleSegmentListClick = (e: React.MouseEvent) => {
    // Suppress the click that closes a freshly-completed selection.
    if (Date.now() - lastSelectionAtRef.current < 250) return
    const target = e.target instanceof Element ? e.target.closest('[data-highlight-id]') : null
    if (!(target instanceof HTMLElement) || !target.dataset.highlightId) return
    setPendingSelection(null)
    setExistingHighlightId(target.dataset.highlightId)
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

  const closeToSessions = () => {
    if (from === 'vocabulary') {
      void navigate({ to: '/vocabulary' })
      return
    }
    void navigate({ to: '/sessions' })
  }

  if (isSessionLoading) {
    return (
      <ModalScreen onClose={closeToSessions} title={t`Session`}>
        <div className='mx-auto max-w-4xl px-4 py-6 text-sm text-gray-500'>{t`Loading session…`}</div>
      </ModalScreen>
    )
  }
  if (!session) {
    return (
      <ModalScreen onClose={closeToSessions} title={t`Session`}>
        <div className='mx-auto max-w-4xl px-4 py-6 text-sm text-gray-500'>{t`Session not found.`}</div>
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
        {session.targetLanguage.toUpperCase()} · {session.cefrLevel} ·{' '}
        <span className='uppercase'>{session.status}</span>
      </span>
    </span>
  )

  return (
    <ModalScreen
      onClose={closeToSessions}
      title={titleNode}
      rightSlot={
        isProcessedOrExported && (
          <Button variant='outline' size='sm' asChild>
            <Link to='/sessions/$sessionId/review' params={{ sessionId }}>
              <ListChecks className='mr-1 h-4 w-4' />
              {t`Triage`}
            </Link>
          </Button>
        )
      }
    >
      <div className='border-b bg-white px-4 py-3'>
        <div className='mx-auto max-w-4xl'>
          <TrackSearchBar value={search} onChange={setSearch} />
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-4 py-3' onClick={handleSegmentListClick}>
        <div className='mx-auto max-w-4xl'>
          {isSegmentsLoading ? (
            <p className='text-sm text-gray-500'>{t`Loading segments…`}</p>
          ) : (
            <SegmentList
              segments={visibleSegments}
              rangesBySegmentId={rangesBySegmentId}
              flashSegmentId={flashSegmentId}
            />
          )}
        </div>
      </div>

      <ProcessButton
        sessionId={sessionId}
        status={session.status}
        highlightCount={highlights?.length ?? 0}
        unprocessedHighlightCount={unprocessedHighlightCount}
        cardCount={cards?.length ?? 0}
        onProcessed={() => {
          void navigate({ to: '/sessions/$sessionId/processing', params: { sessionId } })
        }}
        onGoToTriage={() => {
          void navigate({ to: '/sessions/$sessionId/review', params: { sessionId } })
        }}
      />

      <SessionGlossSheet
        open={glossOpen}
        sessionId={sessionId}
        targetLanguage={session.targetLanguage}
        selection={pendingSelection}
        existingHighlight={existingHighlight}
        anchor={anchor}
        onClose={() => {
          // Keep `anchor`, `pendingSelection`, `existingHighlightId` in state
          // so the popover's closing animation still has its rect / data to
          // render against. They'll be overwritten on the next open.
          setGlossOpen(false)
        }}
      />
    </ModalScreen>
  )
}
