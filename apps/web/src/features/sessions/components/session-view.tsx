import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { ListChecks } from 'lucide-react'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useDebouncedValue } from '../hooks/use-debounced-value'
import {
  useGetStudySession,
  useGetUserPrefs,
  useListSegmentsByTrack,
  useSearchSegments,
  useListHighlightsBySession,
  useCreateHighlight,
  useDeleteHighlight,
} from '../api/sessions-hooks'
import { useListCardsBySession } from '@/features/review/api/review-hooks'
import { readCurrentSelection, SelectionResult } from '../hooks/use-text-selection'
import { buildSegmentRanges } from '../utils/build-segment-ranges'
import { SegmentList } from './segment-list'
import { TrackSearchBar } from './track-search-bar'
import { HighlightSheet } from './highlight-sheet'
import { TapToTranslateSheet } from './tap-to-translate-sheet'
import { HighlightActionMenu } from './highlight-action-menu'
import { ProcessButton } from './process-button'

type Highlight = {
  id: string
  selectionText: string
  note: string | null
  presetTags: string[]
}

export const SessionView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { sessionId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/' })
  const { segment: targetSegmentId } = useSearch({ from: '/_authenticated/_app/sessions/$sessionId/' })

  const { data: session, isLoading: isSessionLoading } = useGetStudySession(sessionId)
  const trackId = session?.textTrackId ?? null
  const [flashSegmentId, setFlashSegmentId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const isSearching = debouncedSearch.length > 0

  const { data: allSegments, isLoading: isSegmentsLoading } = useListSegmentsByTrack(trackId)
  const { data: searchSegments } = useSearchSegments(trackId, debouncedSearch, isSearching)
  const visibleSegments = isSearching ? (searchSegments ?? []) : (allSegments ?? [])

  const { data: prefs } = useGetUserPrefs()
  const tapToTranslateEnabled = prefs?.tapToTranslateEnabled ?? false

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

  const { mutate: createHighlight } = useCreateHighlight(sessionId)
  const { mutate: deleteHighlight } = useDeleteHighlight(sessionId)

  const [pendingSelection, setPendingSelection] = useState<SelectionResult | null>(null)
  const [editingHighlight, setEditingHighlight] = useState<Highlight | null>(null)
  const [tapToTranslateOpen, setTapToTranslateOpen] = useState(false)

  // Action menu state for clicks on existing highlights.
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [menuHighlightId, setMenuHighlightId] = useState<string | null>(null)

  // Guards against the click event that follows mouseup-with-selection from
  // re-opening the action menu when the selection happened to land on an
  // existing highlight span.
  const lastSelectionAtRef = useRef(0)

  useEffect(() => {
    const status = session?.status
    if (status === 'processing' || status === 'failed') {
      void navigate({ to: '/sessions/$sessionId/processing', params: { sessionId }, replace: true })
    }
  }, [session?.status, sessionId, navigate])

  // Deep-link scroll + 1.5s flash. Wait one rAF for the segment list to render,
  // then locate the row by data-segment-id and scroll it into view.
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

  // Selection finished → either gloss it (tap-to-translate) or auto-create a
  // bare highlight. The action menu opens on click of an existing highlight,
  // not from selection.
  useEffect(() => {
    const handleEnd = () => {
      setTimeout(() => {
        const sel = readCurrentSelection()
        if (!sel) return
        lastSelectionAtRef.current = Date.now()
        if (tapToTranslateEnabled) {
          if (tapToTranslateOpen) return
          setPendingSelection(sel)
          setTapToTranslateOpen(true)
        } else {
          createHighlight({
            sessionId,
            startSegmentId: sel.startSegmentId,
            endSegmentId: sel.endSegmentId,
            startOffset: sel.startOffset,
            endOffset: sel.endOffset,
            selectionText: sel.selectionText,
            note: null,
            presetTags: [],
          })
        }
        window.getSelection()?.removeAllRanges()
      }, 30)
    }
    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('touchend', handleEnd)
    return () => {
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('touchend', handleEnd)
    }
  }, [tapToTranslateEnabled, tapToTranslateOpen, createHighlight, sessionId])

  const isProcessedOrExported = session?.status === 'processed' || session?.status === 'exported'

  const handleSegmentListClick = (e: React.MouseEvent) => {
    // Suppress the click that closes a freshly-completed selection.
    if (Date.now() - lastSelectionAtRef.current < 250) return
    const target = e.target instanceof Element ? e.target.closest('[data-highlight-id]') : null
    if (!(target instanceof HTMLElement) || !target.dataset.highlightId) return
    setMenuAnchorEl(target)
    setMenuHighlightId(target.dataset.highlightId)
  }

  const closeMenu = () => {
    setMenuAnchorEl(null)
    setMenuHighlightId(null)
  }

  const menuHighlight = useMemo(() => {
    if (!menuHighlightId) return null
    return highlights?.find((h) => h.id === menuHighlightId) ?? null
  }, [menuHighlightId, highlights])

  const handleEditNote = () => {
    if (!menuHighlight) return
    setEditingHighlight({
      id: menuHighlight.id,
      selectionText: menuHighlight.selectionText,
      note: menuHighlight.note,
      presetTags: menuHighlight.presetTags,
    })
    closeMenu()
  }

  const handleRemove = () => {
    if (!menuHighlightId) return
    deleteHighlight({ sessionId, highlightId: menuHighlightId })
    closeMenu()
  }

  const closeToSessions = () => {
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

  const movieTitle = session.contentSourceTitle ?? t`Untitled`
  const titleNode = (
    <span className='flex min-w-0 flex-col leading-tight'>
      <span className='truncate text-base font-semibold'>
        {movieTitle}
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

      <HighlightSheet
        open={!!editingHighlight}
        sessionId={sessionId}
        highlight={editingHighlight}
        onClose={() => setEditingHighlight(null)}
      />

      <TapToTranslateSheet
        open={tapToTranslateOpen}
        sessionId={sessionId}
        selection={pendingSelection}
        onClose={() => setTapToTranslateOpen(false)}
      />

      <HighlightActionMenu
        anchorEl={menuAnchorEl}
        onEdit={handleEditNote}
        onRemove={handleRemove}
        onClose={closeMenu}
      />
    </ModalScreen>
  )
}
