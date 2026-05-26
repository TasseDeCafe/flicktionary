import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronDown, Loader2, RotateCw, Star, X } from 'lucide-react'
import type {
  Card,
  CardStatus,
  LearningMode,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

const getBackPreview = (card: Card, hideTranslationFields: boolean): string => {
  if (hideTranslationFields) return card.chunk.definition || ''
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
export const TriageEnrichingRow = ({ surfaceForm, status, isRetrying, onRetry }: EnrichingRowProps) => {
  const { t } = useLingui()
  const canRetry = status === 'failed' || status === 'missing'
  return (
    <div className='flex items-center gap-3 border-b py-3'>
      <div className='flex-1'>
        <span className='text-base font-medium'>{surfaceForm}</span>
        {status === 'failed' ? (
          <p className='mt-1 text-sm text-red-600'>{t`Enrichment failed`}</p>
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
  hideTranslationFields?: boolean
  onStatusChange: (cardId: string, status: CardStatus, learningMode?: LearningMode) => void
}

export const TriageRow = ({ sessionId, card, hideTranslationFields = false, onStatusChange }: Props) => {
  const { t } = useLingui()
  const [menuOpen, setMenuOpen] = useState(false)
  const isKept = card.status === 'kept'
  const isActive = isKept && card.chunk.learningMode === 'active'
  const isRejected = card.status === 'rejected' || card.status === 'auto_rejected'
  const preview = getBackPreview(card, hideTranslationFields)

  return (
    <div className='flex items-start gap-3 border-b'>
      <Link
        to='/sessions/$sessionId/review/$cardId'
        params={{ sessionId, cardId: card.id }}
        className='-ml-2 block flex-1 rounded-md px-2 py-3 transition-colors hover:bg-gray-50 active:bg-gray-100'
      >
        <span className='text-base font-medium'>{card.chunk.headword || card.surfaceForm}</span>
        {card.chunk.headword && card.surfaceForm && card.chunk.headword !== card.surfaceForm && (
          <span className='text-muted-foreground ml-2 text-sm'>({card.surfaceForm})</span>
        )}
        {isActive && (
          <span className='ml-2 inline-flex items-center gap-1 align-middle text-xs text-amber-600'>
            <Star className='h-3 w-3' />
            {t`Active`}
          </span>
        )}
        {preview && <p className='mt-1 text-sm'>{preview}</p>}
      </Link>
      <div className='flex shrink-0 items-center gap-1 py-3'>
        <div className='inline-flex'>
          <Button
            size='icon'
            variant={isKept ? 'default' : 'outline'}
            aria-label={t`Keep`}
            className='rounded-r-none'
            onClick={() => onStatusChange(card.id, isKept ? 'pending' : 'kept')}
          >
            <Check className='h-4 w-4' />
          </Button>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                size='icon'
                variant={isKept ? 'default' : 'outline'}
                aria-label={t`Keep options`}
                className='-ml-px w-6 rounded-l-none border-l'
              >
                <ChevronDown className='h-3 w-3' />
              </Button>
            </PopoverTrigger>
            <PopoverContent align='end' className='w-48 p-1'>
              <button
                type='button'
                className='hover:bg-muted flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm'
                onClick={() => {
                  setMenuOpen(false)
                  onStatusChange(card.id, 'kept', 'passive')
                }}
              >
                <span>{t`Keep as passive`}</span>
                {isKept && card.chunk.learningMode === 'passive' && <Check className='h-3 w-3' />}
              </button>
              <button
                type='button'
                className='hover:bg-muted flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm'
                onClick={() => {
                  setMenuOpen(false)
                  onStatusChange(card.id, 'kept', 'active')
                }}
              >
                <span className='flex items-center gap-1.5'>
                  <Star className='h-3 w-3' />
                  {t`Keep as active`}
                </span>
                {isActive && <Check className='h-3 w-3' />}
              </button>
            </PopoverContent>
          </Popover>
        </div>
        <Button
          size='icon'
          variant={isRejected ? 'default' : 'outline'}
          aria-label={t`Reject`}
          onClick={() => onStatusChange(card.id, isRejected ? 'pending' : 'rejected')}
        >
          <X className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}
