import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Brain, ChevronRight, FileText } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { SearchInput } from '@flicktionary/ui/components/search-input'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useDebouncedValue } from '@/features/sessions/hooks/use-debounced-value'
import {
  useGetProcessingStatus,
  useGetStudySession,
  useListHighlightsBySession,
  useRetryEnrichment,
} from '@/features/sessions/api/sessions-hooks'
import { useListCardsBySession, useUpdateCardStatus, useUpdateCardStatusBatch } from '../api/review-hooks'
import { getSessionCardsKey } from '../api/card-cache'
import type {
  Card,
  CardStatus,
  LearningMode,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { TriageRow, TriageEnrichingRow } from './triage-row'
import { AutoRejectedCollapsible } from './auto-rejected-collapsible'
import { useScrollRestoration } from '@/hooks/use-scroll-restoration'

const matchesSearch = (card: Card, q: string): boolean => {
  if (!q) return true
  const haystack = `${card.surfaceForm} ${card.chunk.headword}`.toLowerCase()
  return haystack.includes(q.toLowerCase())
}

type BulkActionsProps = {
  cards: Card[]
  disabled: boolean
  onBulkStatusChange: (cards: Card[], status: CardStatus) => void
}

const BulkActions = ({ cards, disabled, onBulkStatusChange }: BulkActionsProps) => {
  const { t } = useLingui()
  const allKept = cards.every((c) => c.status === 'kept')
  const allRejected = cards.every((c) => c.status === 'rejected')
  return (
    <div className='flex shrink-0 gap-1'>
      <Button
        variant='ghost'
        size='sm'
        className='h-7 text-xs'
        disabled={disabled || allKept}
        onClick={() => onBulkStatusChange(cards, 'kept')}
      >
        {t`Keep all`}
      </Button>
      <Button
        variant='ghost'
        size='sm'
        className='h-7 text-xs'
        disabled={disabled || allRejected}
        onClick={() => onBulkStatusChange(cards, 'rejected')}
      >
        {t`Reject all`}
      </Button>
    </div>
  )
}

export const TriageListView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { sessionId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/review/' })
  const queryClient = useQueryClient()
  const { data: session } = useGetStudySession(sessionId)
  const { data: highlights } = useListHighlightsBySession(sessionId)
  const { data: processingStatus } = useGetProcessingStatus(sessionId, 2000)
  const { mutate: retryEnrichment, isPending: isRetrying } = useRetryEnrichment(sessionId)
  // While the background worker is still enriching highlights, the cards list
  // grows underneath us — poll it so newly-materialized
  // cards replace their "Enriching…" placeholder rows without a manual refresh.
  const isProcessingActive = (processingStatus?.enrichingHighlightIds.length ?? 0) > 0
  const { data: cards, isLoading } = useListCardsBySession(sessionId, {
    refetchInterval: isProcessingActive ? 2000 : false,
  })
  // The poll above stops the moment the status goes idle, which can race the
  // final card insert — force one refetch on the active→idle transition.
  const wasProcessingActiveRef = useRef(isProcessingActive)
  useEffect(() => {
    if (wasProcessingActiveRef.current && !isProcessingActive) {
      queryClient.invalidateQueries({ queryKey: getSessionCardsKey(sessionId) })
    }
    wasProcessingActiveRef.current = isProcessingActive
  }, [isProcessingActive, sessionId, queryClient])
  const { mutate: updateStatus } = useUpdateCardStatus(sessionId)
  const { mutate: updateStatusBatch, isPending: isBatchPending } = useUpdateCardStatusBatch(sessionId)
  const warnings = session?.processingWarnings ?? []

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 200)

  const firstNavigableCardId = useMemo(() => {
    return (cards ?? []).find((c) => c.status !== 'auto_rejected')?.id ?? null
  }, [cards])

  const handleReviewCards = () => {
    if (!firstNavigableCardId) return
    void navigate({
      to: '/sessions/$sessionId/review/$cardId',
      params: { sessionId, cardId: firstNavigableCardId },
    })
  }

  const grouped = useMemo(() => {
    const all = cards ?? []
    const filtered = all.filter((c) => matchesSearch(c, debouncedSearch))
    const yourHighlights = filtered.filter((c) => c.highlightId !== null)
    const llmSuggested = filtered.filter((c) => c.highlightId === null && c.status !== 'auto_rejected')
    const autoRejected = filtered.filter((c) => c.status === 'auto_rejected')
    return { yourHighlights, llmSuggested, autoRejected }
  }, [cards, debouncedSearch])

  const keptCount = (cards ?? []).filter((c) => c.status === 'kept').length

  // Highlights still being enriched in the background have no card yet — render a
  // placeholder row per straggler (and a retry affordance for failed ones).
  const pendingHighlightRows = useMemo(() => {
    const cardHighlightIds = new Set((cards ?? []).map((c) => c.highlightId).filter((id): id is string => !!id))
    const activeSet = new Set(processingStatus?.enrichingHighlightIds ?? [])
    const failedSet = new Set(processingStatus?.failedHighlightIds ?? [])
    return (highlights ?? [])
      .filter((h) => !cardHighlightIds.has(h.id))
      .map((h): { id: string; surfaceForm: string; status: 'enriching' | 'failed' | 'missing' } => {
        const status = failedSet.has(h.id) ? 'failed' : activeSet.has(h.id) ? 'enriching' : 'missing'
        return { id: h.id, surfaceForm: h.selectionText, status }
      })
  }, [highlights, cards, processingStatus])

  // Restores scroll position when the container remounts (e.g. focus-view
  // round-trip). Resets when search changes so a stale offset from a different
  // filtered set never gets applied.
  const filterKey = `${sessionId}|${debouncedSearch}`
  const { ref: scrollRef, onScroll: onScrollSave } = useScrollRestoration<HTMLDivElement>({
    scope: 'triage',
    filterKey,
    ready: (cards?.length ?? 0) > 0 || pendingHighlightRows.length > 0,
  })

  const handleStatusChange = (cardId: string, status: CardStatus, learningMode?: LearningMode) => {
    updateStatus({ cardId, status, learningMode })
  }

  const handleBulkStatusChange = (sectionCards: Card[], status: CardStatus) => {
    const cardIds = sectionCards.filter((c) => c.status !== status).map((c) => c.id)
    if (cardIds.length === 0) return
    updateStatusBatch({ sessionId, cardIds, status, ...(status === 'kept' ? { learningMode: 'passive' } : {}) })
  }

  // Triage and the source view are sibling screens (neither is the parent of
  // the other). The modal chevron means "close stack" → /sessions; the Source
  // cross-jump moves to the right slot as a forward link.
  return (
    <ModalScreen
      onClose={() => navigate({ to: '/sessions' })}
      closeIcon='chevron'
      title={t`Triage`}
      rightSlot={
        <>
          <Button variant='outline' size='sm' asChild>
            <Link to='/sessions/$sessionId' params={{ sessionId }}>
              <FileText className='mr-1 h-4 w-4' />
              {t`Source`}
            </Link>
          </Button>
          <Button variant='outline' size='sm' onClick={handleReviewCards} disabled={!firstNavigableCardId}>
            {t`Review`}
            <ChevronRight className='ml-1 h-4 w-4' />
          </Button>
        </>
      }
    >
      <div className='bg-background border-b px-4 py-3'>
        <div className='mx-auto max-w-4xl'>
          <SearchInput value={search} onChange={setSearch} placeholder={t`Search…`} />
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScrollSave} className='flex-1 overflow-y-auto px-4 py-4'>
        <div className='mx-auto max-w-4xl'>
          {warnings.length > 0 && (
            <div className='mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-400/30 dark:bg-amber-400/10'>
              <div className='font-medium text-amber-800 dark:text-amber-300'>{t`Processing warnings`}</div>
              <ul className='mt-1 list-disc pl-5 text-amber-700 dark:text-amber-300'>
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <p className='text-muted-foreground mt-2 text-xs'>
                {t`Go back to the source view to add or retry highlights.`}
              </p>
            </div>
          )}

          {isLoading && <p className='text-muted-foreground text-sm'>{t`Loading cards…`}</p>}

          {!isLoading && (cards?.length ?? 0) === 0 && pendingHighlightRows.length === 0 && (
            <p className='text-muted-foreground text-sm'>{t`No cards yet. Select some highlights in the source text to generate new cards.`}</p>
          )}

          {(grouped.yourHighlights.length > 0 || pendingHighlightRows.length > 0) && (
            <section className='mb-6'>
              <div className='flex items-center justify-between gap-2'>
                <h2 className='text-muted-foreground text-sm font-semibold tracking-wide uppercase'>
                  {t`Your highlights`} ({grouped.yourHighlights.length + pendingHighlightRows.length})
                </h2>
                <BulkActions
                  cards={grouped.yourHighlights}
                  disabled={isBatchPending}
                  onBulkStatusChange={handleBulkStatusChange}
                />
              </div>
              <div className='mt-2'>
                {grouped.yourHighlights.map((card) => (
                  <TriageRow key={card.id} sessionId={sessionId} card={card} onStatusChange={handleStatusChange} />
                ))}
                {pendingHighlightRows.map((row) => (
                  <TriageEnrichingRow
                    key={row.id}
                    surfaceForm={row.surfaceForm}
                    status={row.status}
                    isRetrying={isRetrying}
                    onRetry={() => retryEnrichment({ sessionId, highlightId: row.id })}
                  />
                ))}
              </div>
            </section>
          )}

          {grouped.llmSuggested.length > 0 && (
            <section className='mb-6'>
              <div className='flex items-center justify-between gap-2'>
                <h2 className='text-muted-foreground text-sm font-semibold tracking-wide uppercase'>
                  {t`LLM-suggested terms`} ({grouped.llmSuggested.length})
                </h2>
                <BulkActions
                  cards={grouped.llmSuggested}
                  disabled={isBatchPending}
                  onBulkStatusChange={handleBulkStatusChange}
                />
              </div>
              <div className='mt-2'>
                {grouped.llmSuggested.map((card) => (
                  <TriageRow key={card.id} sessionId={sessionId} card={card} onStatusChange={handleStatusChange} />
                ))}
              </div>
            </section>
          )}

          <AutoRejectedCollapsible
            sessionId={sessionId}
            cards={grouped.autoRejected}
            onStatusChange={handleStatusChange}
          />
        </div>
      </div>

      <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
        <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
          <Button
            size='xl'
            className='w-full'
            disabled={keptCount === 0 || !session}
            onClick={() => {
              if (!session) return
              void navigate({
                to: '/practice/review/$targetLanguage',
                params: { targetLanguage: session.targetLanguage },
                search: { pool: 'passive', scope: 'mixed', mode: 'read' },
              })
            }}
          >
            <Brain />
            {t`Practice your terms`}
          </Button>
        </div>
      </div>
    </ModalScreen>
  )
}
