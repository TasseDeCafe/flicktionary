import { useMemo, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDebouncedValue } from '@/features/sessions/hooks/use-debounced-value'
import { useListCardsBySession, useUpdateCardStatus } from '../api/review-hooks'
import type { Card, CardStatus } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { TriageRow } from './triage-row'
import { AutoRejectedCollapsible } from './auto-rejected-collapsible'
import { CsvExportButton } from './csv-export-button'

const matchesSearch = (card: Card, q: string): boolean => {
  if (!q) return true
  const haystack = `${card.surfaceForm} ${card.headword}`.toLowerCase()
  return haystack.includes(q.toLowerCase())
}

export const TriageListView = () => {
  const { t } = useLingui()
  const { sessionId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/review/' })
  const { data: cards, isLoading } = useListCardsBySession(sessionId)
  const { mutate: updateStatus } = useUpdateCardStatus(sessionId)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 200)

  const grouped = useMemo(() => {
    const all = cards ?? []
    const filtered = all.filter((c) => matchesSearch(c, debouncedSearch))
    const yourHighlights = filtered.filter((c) => c.highlightId !== null)
    const llmSuggested = filtered.filter((c) => c.highlightId === null && c.status !== 'auto_rejected')
    const autoRejected = filtered.filter((c) => c.status === 'auto_rejected')
    return { yourHighlights, llmSuggested, autoRejected }
  }, [cards, debouncedSearch])

  const keptCount = (cards ?? []).filter((c) => c.status === 'kept').length

  const handleStatusChange = (cardId: string, status: CardStatus) => {
    updateStatus({ cardId, status })
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='border-b bg-white px-4 py-3'>
        <div className='mx-auto flex max-w-4xl items-center justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <Button variant='outline' size='sm' asChild>
              <Link to='/sessions/$sessionId' params={{ sessionId }}>
                <ChevronLeft className='mr-1 h-4 w-4' />
                {t`Subtitles`}
              </Link>
            </Button>
            <h1 className='text-xl font-semibold'>{t`Triage`}</h1>
          </div>
          <Input
            type='search'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t`Search…`}
            className='max-w-xs'
          />
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-4 py-4'>
        <div className='mx-auto max-w-4xl'>
          {isLoading && <p className='text-muted-foreground text-sm'>{t`Loading cards…`}</p>}

          {!isLoading && (cards?.length ?? 0) === 0 && (
            <p className='text-muted-foreground text-sm'>{t`No cards yet. Process the session to generate them.`}</p>
          )}

          {grouped.yourHighlights.length > 0 && (
            <section className='mb-6'>
              <h2 className='text-muted-foreground text-sm font-semibold tracking-wide uppercase'>
                {t`Your highlights`} ({grouped.yourHighlights.length})
              </h2>
              <div className='mt-2'>
                {grouped.yourHighlights.map((card) => (
                  <TriageRow key={card.id} sessionId={sessionId} card={card} onStatusChange={handleStatusChange} />
                ))}
              </div>
            </section>
          )}

          {grouped.llmSuggested.length > 0 && (
            <section className='mb-6'>
              <h2 className='text-muted-foreground text-sm font-semibold tracking-wide uppercase'>
                {t`LLM-suggested chunks`} ({grouped.llmSuggested.length})
              </h2>
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

      <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 p-3 backdrop-blur'>
        <div className='mx-auto flex max-w-4xl items-center justify-between gap-3'>
          <span className='text-muted-foreground text-sm'>{t`${keptCount} card(s) kept.`}</span>
          <CsvExportButton sessionId={sessionId} keptCount={keptCount} />
        </div>
      </div>
    </div>
  )
}
