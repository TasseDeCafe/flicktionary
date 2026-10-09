import { useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'

// A capture row's way into the card's focus view. Icon-only on phones,
// labeled from sm up.
export const EditCardButton = ({
  card,
  onOpen,
}: {
  card: { cardId: string; sessionId: string }
  onOpen?: () => void
}) => {
  const { t } = useLingui()
  return (
    <Button variant='outline' size='sm' asChild>
      <Link
        to='/sessions/$sessionId/review/$cardId'
        params={{ sessionId: card.sessionId, cardId: card.cardId }}
        search={{ scope: 'language' as const }}
        aria-label={t`Edit card`}
        onClick={onOpen}
      >
        <Pencil className='size-3.5' />
        <span className='hidden sm:inline'>{t`Edit card`}</span>
      </Link>
    </Button>
  )
}
