import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Card, CardStatus } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { TriageRow } from './triage-row'

type Props = {
  sessionId: string
  cards: Card[]
  onStatusChange: (cardId: string, status: CardStatus) => void
}

export const AutoRejectedCollapsible = ({ sessionId, cards, onStatusChange }: Props) => {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const filteredCount = cards.length
  if (filteredCount === 0) return null
  return (
    <div className='mt-4 rounded-md border bg-gray-50/40'>
      <Button variant='ghost' className='w-full justify-start px-3 py-2 text-sm' onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className='mr-1 h-4 w-4' /> : <ChevronRight className='mr-1 h-4 w-4' />}
        {t`Show ${filteredCount} filtered out (below your level)`}
      </Button>
      {open && (
        <div className='px-3 pb-2'>
          {cards.map((card) => (
            <TriageRow key={card.id} sessionId={sessionId} card={card} onStatusChange={onStatusChange} />
          ))}
        </div>
      )}
    </div>
  )
}
