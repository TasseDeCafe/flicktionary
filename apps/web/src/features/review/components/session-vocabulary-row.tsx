import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { Loader2, RotateCw, Trash2 } from 'lucide-react'
import type { Card } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { cardHasBasicData } from '../utils/card-has-basic-data'

// Placeholder shaped like a real row (headword bar + preview line + the single
// Remove icon-button square) so the list doesn't jump when cards load.
export const SessionVocabularyRowSkeleton = () => (
  <div className='flex items-start gap-3 border-b'>
    <div className='flex-1 px-2 py-3'>
      <Skeleton className='h-5 w-32' />
      <Skeleton className='mt-2 h-4 w-48' />
    </div>
    <div className='flex shrink-0 items-center gap-1 py-3'>
      <Skeleton className='h-9 w-9' />
    </div>
  </div>
)

// Presence-based: with the translations pref off, `translation` is only ever
// set manually — when present it's worth surfacing over the definition.
const getBackPreview = (card: Card): string => {
  return card.chunk.translation || card.chunk.definition || ''
}

type EnrichingRowProps = {
  surfaceForm: string
  status: 'enriching' | 'failed' | 'missing'
  isRetrying: boolean
  onRetry: () => void
}

// Placeholder row for a highlight whose card hasn't been materialized yet:
// either still being enriched in the background, or failed (with a retry).
export const EnrichingRow = ({ surfaceForm, status, isRetrying, onRetry }: EnrichingRowProps) => {
  const { t } = useLingui()
  const canRetry = status === 'failed' || status === 'missing'
  return (
    <div className='flex items-center gap-3 border-b py-3'>
      <div className='flex-1'>
        <span className='text-base font-medium'>{surfaceForm}</span>
        {status === 'failed' ? (
          <p className='text-destructive mt-1 text-sm'>{t`Enrichment failed`}</p>
        ) : status === 'missing' ? (
          <p className='text-muted-foreground mt-1 text-sm'>{t`Enrichment has not started yet.`}</p>
        ) : (
          <div className='text-muted-foreground mt-1 flex items-center gap-1.5 text-sm'>
            <Loader2 className='h-3 w-3 animate-spin' />
            {t`Enriching…`}
          </div>
        )}
      </div>
      {canRetry && (
        <Button size='sm' variant='outline' onClick={onRetry} disabled={isRetrying}>
          <RotateCw className='mr-1 h-3 w-3' />
          {status === 'missing' ? t`Start` : t`Retry`}
        </Button>
      )}
    </div>
  )
}

type Props = {
  sessionId: string
  card: Card
  onRemove: (cardId: string) => void
}

// One row in the Session vocabulary list. Cards auto-keep once they have basic
// data, so there is no Keep step — the only control is Remove-from-session
// (unkeep), which drops the row from the list immediately (the optimistic
// status flip moves it to `rejected`, filtered out of the view). A data-less
// note-only stub still shows here with a "needs data" hint; opening it and
// generating data auto-keeps it.
export const SessionVocabularyRow = ({ sessionId, card, onRemove }: Props) => {
  const { t } = useLingui()
  const preview = getBackPreview(card)
  const needsData = !cardHasBasicData(card)

  return (
    <div className='flex items-start gap-3 border-b'>
      <Link
        to='/sessions/$sessionId/review/$cardId'
        params={{ sessionId, cardId: card.id }}
        className='hover:bg-accent active:bg-accent -ml-2 block flex-1 rounded-md px-2 py-3 transition-colors'
      >
        <span className='text-base font-medium'>{card.chunk.headword || card.surfaceForm}</span>
        {card.chunk.headword && card.surfaceForm && card.chunk.headword !== card.surfaceForm && (
          <span className='text-muted-foreground ml-2 text-sm'>({card.surfaceForm})</span>
        )}
        {preview ? (
          <p className='mt-1 text-sm'>{preview}</p>
        ) : (
          needsData && <p className='text-muted-foreground mt-1 text-sm'>{t`Needs data — open to generate`}</p>
        )}
      </Link>
      <div className='flex shrink-0 items-center gap-1 py-3'>
        <Button size='icon' variant='outline' aria-label={t`Remove from session`} onClick={() => onRemove(card.id)}>
          <Trash2 className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}
