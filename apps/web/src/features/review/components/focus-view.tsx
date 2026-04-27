import { useMemo } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import type { Card } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useGetCard, useListCardsBySession, useUpdateCardStatus } from '../api/review-hooks'
import { FullExplorationRenderer } from './full-exploration-renderer'
import { EditableFrontBack } from './editable-front-back'
import { PerCardChat } from './per-card-chat'
import { buildKeptCardCursor } from '../hooks/use-card-list-cursor'
import { useFocusKeyboardNav } from '../hooks/focus-keyboard-nav'

const computeDefaults = (card: Card): { front: string; back: string } => {
  const surface = card.surfaceForm
  const headword = card.headword
  const definition = (card.fullExploration?.definition as string | undefined) ?? ''
  const translation = (card.fullExploration?.translation as string | undefined) ?? ''
  const examples = card.fullExploration?.examples
  const firstExample = Array.isArray(examples) && typeof examples[0] === 'string' ? (examples[0] as string) : ''
  const front = surface || headword
  const back = [definition, translation, firstExample].filter((s) => s && s.trim().length > 0).join('\n\n')
  return { front, back }
}

export const FocusView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { sessionId, cardId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/review/$cardId' })

  const { data: card, isLoading } = useGetCard(cardId)
  const { data: cards } = useListCardsBySession(sessionId)
  const { mutate: updateStatus } = useUpdateCardStatus(sessionId)

  const cursor = useMemo(() => buildKeptCardCursor(cards ?? [], cardId), [cards, cardId])

  const goPrev = () => {
    if (cursor.prev) {
      void navigate({ to: '/sessions/$sessionId/review/$cardId', params: { sessionId, cardId: cursor.prev.id } })
    }
  }
  const goNext = () => {
    if (cursor.next) {
      void navigate({ to: '/sessions/$sessionId/review/$cardId', params: { sessionId, cardId: cursor.next.id } })
    }
  }
  useFocusKeyboardNav({ onPrev: goPrev, onNext: goNext })

  if (isLoading) {
    return <div className='mx-auto max-w-3xl px-4 py-6 text-sm text-gray-500'>{t`Loading card…`}</div>
  }
  if (!card) {
    return <div className='mx-auto max-w-3xl px-4 py-6 text-sm text-gray-500'>{t`Card not found.`}</div>
  }

  const defaults = computeDefaults(card)
  const isKept = card.status === 'kept'
  const isRejected = card.status === 'rejected' || card.status === 'auto_rejected'

  return (
    <div className='flex h-full flex-col'>
      <div className='border-b bg-white px-4 py-3'>
        <div className='mx-auto flex max-w-3xl items-center gap-3'>
          <Button variant='ghost' size='icon' onClick={goPrev} disabled={!cursor.prev} aria-label={t`Previous card`}>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <Button variant='ghost' size='icon' onClick={goNext} disabled={!cursor.next} aria-label={t`Next card`}>
            <ArrowRight className='h-4 w-4' />
          </Button>
          <div className='flex-1 text-sm text-gray-600'>
            {(() => {
              const position = cursor.index + 1
              const total = cursor.total
              return cursor.index >= 0 ? t`Card ${position} of ${total}` : t`Standalone`
            })()}
          </div>
          <div className='flex gap-1'>
            <Button
              size='icon'
              variant={isKept ? 'default' : 'outline'}
              onClick={() => updateStatus({ cardId: card.id, status: isKept ? 'pending' : 'kept' })}
              aria-label={t`Keep`}
            >
              <Check className='h-4 w-4' />
            </Button>
            <Button
              size='icon'
              variant={isRejected ? 'default' : 'outline'}
              onClick={() => updateStatus({ cardId: card.id, status: isRejected ? 'pending' : 'rejected' })}
              aria-label={t`Reject`}
            >
              <X className='h-4 w-4' />
            </Button>
          </div>
          <Button variant='ghost' asChild>
            <Link to='/sessions/$sessionId/review' params={{ sessionId }}>{t`Back to triage`}</Link>
          </Button>
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-4 py-4'>
        <div className='mx-auto flex max-w-3xl flex-col gap-6'>
          <section>
            <h2 className='mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase'>{t`Card`}</h2>
            <EditableFrontBack
              key={card.id}
              cardId={card.id}
              defaultFront={defaults.front}
              defaultBack={defaults.back}
              initialFrontOverride={card.frontOverride}
              initialBackOverride={card.backOverride}
            />
          </section>

          <section>
            <h2 className='mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase'>{t`Full exploration`}</h2>
            {Object.keys(card.fullExploration ?? {}).length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                {t`No exploration yet — this card was suggested by the difficult-words pass and has not been deeply explored.`}
              </p>
            ) : (
              <FullExplorationRenderer exploration={card.fullExploration ?? {}} />
            )}
          </section>

          <section>
            <h2 className='mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase'>{t`Chat`}</h2>
            <PerCardChat key={card.id} cardId={card.id} />
          </section>
        </div>
      </div>
    </div>
  )
}
