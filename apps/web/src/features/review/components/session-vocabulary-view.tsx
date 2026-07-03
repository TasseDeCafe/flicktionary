import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Brain, ChevronRight } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { SearchInput } from '@flicktionary/ui/components/search-input'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useDebouncedValue } from '@/features/sessions/hooks/use-debounced-value'
import {
  useGetProcessingStatus,
  useGetStudySession,
  useListHighlightsBySession,
  useRetryEnrichment,
} from '@/features/sessions/api/sessions-hooks'
import { useListCardsBySession, useRemoveCardFromSession } from '../api/review-hooks'
import { getSessionCardsKey } from '../api/card-cache'
import type { Card } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { SessionVocabularyRow, EnrichingRow, SessionVocabularyRowSkeleton } from './session-vocabulary-row'
import { useScrollRestoration } from '@/hooks/use-scroll-restoration'

const matchesSearch = (card: Card, q: string): boolean => {
  if (!q) return true
  const haystack = `${card.surfaceForm} ${card.chunk.headword}`.toLowerCase()
  return haystack.includes(q.toLowerCase())
}

export const SessionVocabularyView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { sessionId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/review/' })
  const queryClient = useQueryClient()
  const { data: session } = useGetStudySession(sessionId)
  const { data: highlights } = useListHighlightsBySession(sessionId)
  const { data: processingStatus, isLoading: isProcessingStatusLoading } = useGetProcessingStatus(sessionId, 2000)
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
  const { mutate: removeFromSession } = useRemoveCardFromSession(sessionId)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 200)

  // Cards auto-keep once they have basic data, so this list shows the kept terms
  // plus any data-less note-only stubs still waiting on data (`needs_data`).
  // `removed` never shows — and because Remove flips status in place (the
  // optimistic cache mutates rather than dropping the row), removing a row moves
  // it to `removed` and this filter drops it immediately.
  const visibleCards = useMemo(() => {
    const all = cards ?? []
    return all.filter((c) => (c.status === 'kept' || c.status === 'needs_data') && matchesSearch(c, debouncedSearch))
  }, [cards, debouncedSearch])

  const keptCount = (cards ?? []).filter((c) => c.status === 'kept').length

  const firstNavigableCardId = useMemo(() => visibleCards[0]?.id ?? null, [visibleCards])

  const handleReviewCards = () => {
    if (!firstNavigableCardId) return
    void navigate({
      to: '/sessions/$sessionId/review/$cardId',
      params: { sessionId, cardId: firstNavigableCardId },
    })
  }

  // Highlights still being enriched in the background have no card yet — render a
  // placeholder row per straggler (and a retry affordance for failed ones).
  const pendingHighlightRows = useMemo(() => {
    const cardHighlightIds = new Set((cards ?? []).map((c) => c.highlightId).filter((id): id is string => !!id))
    const activeSet = new Set(processingStatus?.enrichingHighlightIds ?? [])
    const failedSet = new Set(processingStatus?.failedHighlightIds ?? [])
    return (highlights ?? [])
      .filter((h) => !cardHighlightIds.has(h.id))
      .map((h): { id: string; surfaceForm: string; status: 'enriching' | 'failed' | 'missing' } => {
        // Until the processing-status query has returned, we don't yet know
        // whether an uncarded highlight is enqueued or genuinely not started —
        // default to the enriching shimmer rather than flashing a Start/Retry
        // affordance that makes a freshly-opened list look like it failed.
        const status = failedSet.has(h.id)
          ? 'failed'
          : activeSet.has(h.id) || isProcessingStatusLoading
            ? 'enriching'
            : 'missing'
        return { id: h.id, surfaceForm: h.selectionText, status }
      })
  }, [highlights, cards, processingStatus, isProcessingStatusLoading])

  // Restores scroll position when the container remounts (e.g. focus-view
  // round-trip). Resets when search changes so a stale offset from a different
  // filtered set never gets applied.
  const filterKey = `${sessionId}|${debouncedSearch}`
  const { ref: scrollRef, onScroll: onScrollSave } = useScrollRestoration<HTMLDivElement>({
    scope: 'session-vocabulary',
    filterKey,
    ready: (cards?.length ?? 0) > 0 || pendingHighlightRows.length > 0,
  })

  const handleRemove = (cardId: string) => {
    // Remove-from-session = unkeep this card. Non-destructive: it survives in
    // Vocabulary if kept elsewhere; the count badge decrements; the last keep
    // takes count to 0 and it leaves Vocabulary naturally.
    removeFromSession({ cardId })
  }

  const warnings = session?.processingWarnings ?? []
  const hasVisibleContent = visibleCards.length > 0 || pendingHighlightRows.length > 0

  // Back follows the screen hierarchy: sessions → source → session vocabulary → focus.
  return (
    <ModalScreen
      onClose={() => navigate({ to: '/sessions/$sessionId', params: { sessionId } })}
      closeIcon='chevron'
      title={t`Session vocabulary`}
      rightSlot={
        <Button variant='outline' size='sm' onClick={handleReviewCards} disabled={!firstNavigableCardId}>
          {t`Review`}
          <ChevronRight className='ml-1 h-4 w-4' />
        </Button>
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

          {isLoading && (
            <div className='mt-2'>
              <SkeletonList
                count={Math.min(highlights?.length || 4, 8)}
                renderItem={() => <SessionVocabularyRowSkeleton />}
              />
            </div>
          )}

          {!isLoading && !hasVisibleContent && (
            <p className='text-muted-foreground text-sm'>{t`No terms yet. Select some highlights in the source text to add terms.`}</p>
          )}

          {!isLoading && hasVisibleContent && (
            <div className='mt-2'>
              {visibleCards.map((card) => (
                <SessionVocabularyRow key={card.id} sessionId={sessionId} card={card} onRemove={handleRemove} />
              ))}
              {pendingHighlightRows.map((row) => (
                <EnrichingRow
                  key={row.id}
                  surfaceForm={row.surfaceForm}
                  status={row.status}
                  isRetrying={isRetrying}
                  onRetry={() => retryEnrichment({ sessionId, highlightId: row.id })}
                />
              ))}
            </div>
          )}
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
                to: '/practice/recap/$targetLanguage',
                params: { targetLanguage: session.targetLanguage },
                search: { studySessionId: session.id },
              })
            }}
          >
            <Brain />
            {t`Quiz your terms`}
          </Button>
        </div>
      </div>
    </ModalScreen>
  )
}
