import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronDown, Star, X } from 'lucide-react'
import type {
  Card,
  CardStatus,
  LearningMode,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

const getBackPreview = (card: Card, hideTranslationFields: boolean): string => {
  if (hideTranslationFields) return card.chunk.definition || ''
  return card.chunk.translation || card.chunk.definition || ''
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
    <div className='flex items-start gap-3 border-b py-3'>
      <div className='flex-1'>
        <Link
          to='/sessions/$sessionId/review/$cardId'
          params={{ sessionId, cardId: card.id }}
          className='text-base font-medium hover:underline'
        >
          {card.chunk.headword || card.surfaceForm}
        </Link>
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
      </div>
      <div className='flex shrink-0 items-center gap-1'>
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
