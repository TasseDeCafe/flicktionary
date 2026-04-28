import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { ListChecks } from 'lucide-react'
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

  const { data: session, isLoading: isSessionLoading } = useGetStudySession(sessionId)
  const trackId = session?.textTrackId ?? null

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const isSearching = debouncedSearch.length > 0

  const { data: allSegments, isLoading: isSegmentsLoading } = useListSegmentsByTrack(trackId)
  const { data: searchSegments } = useSearchSegments(trackId, debouncedSearch, isSearching)
  const visibleSegments = isSearching ? (searchSegments ?? []) : (allSegments ?? [])

  const { data: prefs } = useGetUserPrefs()
  const tapToTranslateEnabled = prefs?.tapToTranslateEnabled ?? false

  const { data: highlights } = useListHighlightsBySession(sessionId)
  const rangesBySegmentId = useMemo(
    () => buildSegmentRanges(highlights ?? [], visibleSegments),
    [highlights, visibleSegments]
  )

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

  if (isSessionLoading) {
    return <div className='mx-auto max-w-4xl px-4 py-6 text-sm text-gray-500'>{t`Loading session…`}</div>
  }
  if (!session) {
    return <div className='mx-auto max-w-4xl px-4 py-6 text-sm text-gray-500'>{t`Session not found.`}</div>
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='border-b bg-white px-4 py-3'>
        <div className='mx-auto flex max-w-4xl items-center gap-3'>
          {session.contentSourcePosterUrl && (
            <img
              src={session.contentSourcePosterUrl}
              alt={session.contentSourceTitle ?? ''}
              className='h-14 w-10 shrink-0 rounded object-cover'
              loading='lazy'
            />
          )}
          <div className='min-w-0'>
            <h1 className='truncate text-lg font-semibold'>
              {session.contentSourceTitle ?? t`Untitled`}
              {session.contentSourceYear ? ` (${session.contentSourceYear})` : ''}
            </h1>
            <div className='text-muted-foreground text-xs'>
              {session.targetLanguage.toUpperCase()} · {session.cefrLevel} ·{' '}
              <span className='uppercase'>{session.status}</span>
            </div>
          </div>
          <div className='ml-auto flex gap-2'>
            {isProcessedOrExported && (
              <Button variant='outline' size='sm' asChild>
                <Link to='/sessions/$sessionId/review' params={{ sessionId }}>
                  <ListChecks className='mr-1 h-4 w-4' />
                  {t`View triage`}
                </Link>
              </Button>
            )}
          </div>
        </div>
        <div className='mx-auto mt-3 max-w-4xl'>
          <TrackSearchBar value={search} onChange={setSearch} />
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-4 py-3' onClick={handleSegmentListClick}>
        <div className='mx-auto max-w-4xl'>
          {isSegmentsLoading ? (
            <p className='text-sm text-gray-500'>{t`Loading segments…`}</p>
          ) : (
            <SegmentList segments={visibleSegments} rangesBySegmentId={rangesBySegmentId} />
          )}
        </div>
      </div>

      <ProcessButton
        sessionId={sessionId}
        status={session.status}
        highlightCount={highlights?.length ?? 0}
        onProcessed={() => {
          void navigate({ to: '/sessions/$sessionId/processing', params: { sessionId } })
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
    </div>
  )
}
