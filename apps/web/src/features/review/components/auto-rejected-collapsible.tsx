import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type {
  Card,
  CardStatus,
  LearningMode,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { TriageRow } from './triage-row'

type Props = {
  sessionId: string
  cards: Card[]
  hideTranslationFields?: boolean
  onStatusChange: (cardId: string, status: CardStatus, learningMode?: LearningMode) => void
}

export const AutoRejectedCollapsible = ({ sessionId, cards, hideTranslationFields = false, onStatusChange }: Props) => {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const filteredCount = cards.length
  if (filteredCount === 0) return null
  return (
    <div className='bg-muted/40 mt-4 rounded-md border'>
      <Button variant='ghost' className='w-full justify-start px-3 py-2 text-sm' onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className='mr-1 h-4 w-4' /> : <ChevronRight className='mr-1 h-4 w-4' />}
        {t`Show ${filteredCount} filtered out (below your level)`}
      </Button>
      {open && (
        <div className='px-3 pb-2'>
          {cards.map((card) => (
            <TriageRow
              key={card.id}
              sessionId={sessionId}
              card={card}
              hideTranslationFields={hideTranslationFields}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
