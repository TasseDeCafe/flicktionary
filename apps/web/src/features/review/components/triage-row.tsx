import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'
import type { Card } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { CardStatus } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

const getBackPreview = (card: Card): string => card.translation || card.definition || ''

type Props = {
  sessionId: string
  card: Card
  onStatusChange: (cardId: string, status: CardStatus) => void
}

export const TriageRow = ({ sessionId, card, onStatusChange }: Props) => {
  const { t } = useLingui()
  const isKept = card.status === 'kept'
  const isRejected = card.status === 'rejected' || card.status === 'auto_rejected'
  const preview = getBackPreview(card)

  return (
    <div className='flex items-start gap-3 border-b py-3'>
      <div className='flex-1'>
        <Link
          to='/sessions/$sessionId/review/$cardId'
          params={{ sessionId, cardId: card.id }}
          className='text-base font-medium hover:underline'
        >
          {card.headword || card.surfaceForm}
        </Link>
        {card.headword && card.surfaceForm && card.headword !== card.surfaceForm && (
          <span className='text-muted-foreground ml-2 text-sm'>({card.surfaceForm})</span>
        )}
        {preview && <p className='mt-1 text-sm'>{preview}</p>}
      </div>
      <div className='flex shrink-0 gap-1'>
        <Button
          size='icon'
          variant={isKept ? 'default' : 'outline'}
          aria-label={t`Keep`}
          onClick={() => onStatusChange(card.id, isKept ? 'pending' : 'kept')}
        >
          <Check className='h-4 w-4' />
        </Button>
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
