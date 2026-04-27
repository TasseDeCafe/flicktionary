import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Highlighter, ListChecks } from 'lucide-react'
import { useDebouncedValue } from '../hooks/use-debounced-value'
import {
  useGetStudySession,
  useGetUserPrefs,
  useListSegmentsByTrack,
  useSearchSegments,
  useListHighlightsBySession,
} from '../api/sessions-hooks'
import { readCurrentSelection, SelectionResult } from '../hooks/use-text-selection'
import { SegmentList } from './segment-list'
import { TrackSearchBar } from './track-search-bar'
import { HighlightSheet } from './highlight-sheet'
import { TapToTranslateSheet } from './tap-to-translate-sheet'
import { ProcessButton } from './process-button'

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
  const highlightedSegmentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const h of highlights ?? []) {
      ids.add(h.startSegmentId)
      ids.add(h.endSegmentId)
    }
    return ids
  }, [highlights])

  const [pendingSelection, setPendingSelection] = useState<SelectionResult | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [tapToTranslateOpen, setTapToTranslateOpen] = useState(false)

  // Only redirect away from the subtitles UI while the pipeline is in flight or
  // has crashed — processed/exported sessions stay browsable so users can add
  // missed highlights and re-run the pass.
  useEffect(() => {
    const status = session?.status
    if (status === 'processing' || status === 'failed') {
      void navigate({ to: '/sessions/$sessionId/processing', params: { sessionId }, replace: true })
    }
  }, [session?.status, sessionId, navigate])

  // Auto-open the tap-to-translate overlay when the user finishes a selection
  // (mouseup / touchend). The button click is preserved as a fallback for the
  // toggle-off path; in the toggle-on path the button is hidden.
  useEffect(() => {
    if (!tapToTranslateEnabled) return
    const handleEnd = () => {
      // Defer one tick so the browser has finalised window.getSelection().
      setTimeout(() => {
        if (tapToTranslateOpen) return
        const sel = readCurrentSelection()
        if (!sel) return
        setPendingSelection(sel)
        setTapToTranslateOpen(true)
        // Clear the native selection so a stray subsequent mouseup with the same
        // range can't re-trigger the overlay.
        window.getSelection()?.removeAllRanges()
      }, 30)
    }
    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('touchend', handleEnd)
    return () => {
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('touchend', handleEnd)
    }
  }, [tapToTranslateEnabled, tapToTranslateOpen])

  const isProcessedOrExported = session?.status === 'processed' || session?.status === 'exported'

  const handleHighlightClick = () => {
    const sel = readCurrentSelection()
    if (!sel) return
    setPendingSelection(sel)
    setSheetOpen(true)
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
            {!tapToTranslateEnabled && (
              <Button variant='secondary' size='sm' onClick={handleHighlightClick}>
                <Highlighter className='mr-1 h-4 w-4' />
                {t`Highlight selection`}
              </Button>
            )}
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

      <div className='flex-1 overflow-y-auto px-4 py-3'>
        <div className='mx-auto max-w-4xl'>
          {isSegmentsLoading ? (
            <p className='text-sm text-gray-500'>{t`Loading segments…`}</p>
          ) : (
            <SegmentList segments={visibleSegments} highlightedSegmentIds={highlightedSegmentIds} />
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
        open={sheetOpen}
        sessionId={sessionId}
        selection={pendingSelection}
        onClose={() => setSheetOpen(false)}
      />

      <TapToTranslateSheet
        open={tapToTranslateOpen}
        sessionId={sessionId}
        selection={pendingSelection}
        onClose={() => setTapToTranslateOpen(false)}
      />
    </div>
  )
}
