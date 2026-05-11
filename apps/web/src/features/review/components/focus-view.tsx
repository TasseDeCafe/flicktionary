import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, ExternalLink, Sparkles, X } from 'lucide-react'
import {
  useExploreCard,
  useGetCard,
  useListCardsBySession,
  useTextSegmentsWindow,
  useUpdateCardStatus,
} from '../api/review-hooks'
import { useGetStudySession, useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { FullExplorationRenderer } from './full-exploration-renderer'
import { EditableCardFields } from './editable-card-fields'
import { EditableGrammarPanel } from './editable-grammar-panel'
import { GrammarChips } from './grammar-chips'
import { GroundingBadge } from './grounding-badge'
import { PerCardChat } from './per-card-chat'
import { buildKeptCardCursor } from '../hooks/use-card-list-cursor'
import { useFocusKeyboardNav } from '../hooks/focus-keyboard-nav'

type ContextWindowProps = {
  sessionId: string
  textTrackId: string
  segmentId: string
  fromVocabulary: boolean
}

const SurroundingContextBlock = ({ sessionId, textTrackId, segmentId, fromVocabulary }: ContextWindowProps) => {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const { data } = useTextSegmentsWindow({ textTrackId, segmentId, radius: 2 })

  return (
    <div className='mb-3'>
      <div className='flex items-center justify-between gap-2'>
        <button
          type='button'
          onClick={() => setOpen((v) => !v)}
          className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-semibold tracking-wide uppercase'
        >
          {open ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
          {t`Context`}
        </button>
        <Button variant='outline' size='sm' asChild>
          <Link
            to='/sessions/$sessionId'
            params={{ sessionId }}
            search={{ segment: segmentId, ...(fromVocabulary ? { from: 'vocabulary' as const } : {}) }}
          >
            <ExternalLink className='mr-1 h-4 w-4' />
            {t`Open source`}
          </Link>
        </Button>
      </div>
      {open && data && (
        <div className='border-muted bg-muted/30 mt-2 rounded-md border px-3 py-2 text-sm'>
          {data.data.map((seg) => {
            const isFocus = seg.id === data.centerSegmentId
            return (
              <div key={seg.id} className={isFocus ? 'font-medium' : 'text-muted-foreground'}>
                {isFocus ? `> ${seg.text}` : seg.text}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const FocusView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { sessionId, cardId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/review/$cardId' })
  const { from, source } = useSearch({ from: '/_authenticated/_app/sessions/$sessionId/review/$cardId' })
  const fromVocabulary = from === 'vocabulary'
  const shouldLoadSessionScope = !fromVocabulary || source === 'available'

  const { data: cards, dataUpdatedAt: cardsUpdatedAt } = useListCardsBySession(sessionId, {
    enabled: shouldLoadSessionScope,
  })
  const initialCard = useMemo(() => cards?.find((listCard) => listCard.id === cardId), [cards, cardId])
  const { data: card, isLoading } = useGetCard(cardId, initialCard, cardsUpdatedAt)
  const { data: session } = useGetStudySession(sessionId, { enabled: shouldLoadSessionScope })
  // Vocabulary entries (including adhoc) intentionally skip the session
  // fetch, so we read the native language from user prefs to keep
  // sameLanguage detection working without a session row. When the session
  // IS loaded, we still prefer it (it carries the snapshotted native
  // language at session creation time, which matches what the LLM saw).
  const { data: userPrefs } = useGetUserPrefs()
  const { mutate: updateStatus } = useUpdateCardStatus(sessionId)
  const { mutate: exploreCard, isPending: isExploringAny, variables: exploringVariables } = useExploreCard()
  const isExploring = isExploringAny && exploringVariables?.cardId === cardId

  const cursor = useMemo(() => buildKeptCardCursor(cards ?? [], cardId), [cards, cardId])

  // Preserve the `from` origin across prev/next so the close button still
  // knows where to land after the user navigates around.
  const search = from ? { from } : undefined
  const goPrev = () => {
    if (cursor.prev) {
      void navigate({
        to: '/sessions/$sessionId/review/$cardId',
        params: { sessionId, cardId: cursor.prev.id },
        search,
      })
    }
  }
  const goNext = () => {
    if (cursor.next) {
      void navigate({
        to: '/sessions/$sessionId/review/$cardId',
        params: { sessionId, cardId: cursor.next.id },
        search,
      })
    }
  }
  useFocusKeyboardNav({ onPrev: goPrev, onNext: goNext })

  const closeToTriage = () => {
    if (from === 'vocabulary') {
      void navigate({ to: '/vocabulary' })
      return
    }
    void navigate({ to: '/sessions/$sessionId/review', params: { sessionId } })
  }

  if (isLoading) {
    return (
      <ModalScreen onClose={closeToTriage} closeIcon='chevron' title={t`Card`}>
        <div className='mx-auto max-w-4xl px-4 py-6 text-sm text-gray-500'>{t`Loading card…`}</div>
      </ModalScreen>
    )
  }
  if (!card) {
    return (
      <ModalScreen onClose={closeToTriage} closeIcon='chevron' title={t`Card`}>
        <div className='mx-auto max-w-4xl px-4 py-6 text-sm text-gray-500'>{t`Card not found.`}</div>
      </ModalScreen>
    )
  }

  const isKept = card.status === 'kept'
  const isRejected = card.status === 'rejected' || card.status === 'auto_rejected'
  const hasExtras = Object.keys(card.chunk.explorationExtras ?? {}).length > 0
  const hasBasicData = !!(
    (card.chunk.translation && card.chunk.translation.trim().length > 0) ||
    (card.chunk.definition && card.chunk.definition.trim().length > 0) ||
    (card.chunk.targetExample && card.chunk.targetExample.trim().length > 0)
  )
  const targetLanguage = session?.targetLanguage ?? card.chunk.targetLanguage
  const nativeLanguage = session?.nativeLanguage ?? userPrefs?.nativeLanguage ?? null
  const sameLanguage = !!nativeLanguage && nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  const cardPosition = cursor.index + 1
  const cardTotal = cursor.total
  const positionLabel = cursor.index >= 0 ? t`Card ${cardPosition} of ${cardTotal}` : t`Standalone`
  const sourceSessionId = shouldLoadSessionScope ? card.studySessionId : undefined
  // Vocabulary entries are already kept by definition, so the keep/reject
  // toggles and the per-session position counter don't apply here. Show the
  // chunk's headword as the title instead.
  const title = fromVocabulary ? card.chunk.headword : positionLabel
  const rightSlot = fromVocabulary ? undefined : (
    <>
      <Button
        size='icon-sm'
        variant={isKept ? 'default' : 'outline'}
        onClick={() => updateStatus({ cardId: card.id, status: isKept ? 'pending' : 'kept' })}
        aria-label={t`Keep`}
      >
        <Check className='h-4 w-4' />
      </Button>
      <Button
        size='icon-sm'
        variant={isRejected ? 'default' : 'outline'}
        onClick={() => updateStatus({ cardId: card.id, status: isRejected ? 'pending' : 'rejected' })}
        aria-label={t`Reject`}
      >
        <X className='h-4 w-4' />
      </Button>
    </>
  )

  return (
    <ModalScreen onClose={closeToTriage} closeIcon='chevron' title={title} rightSlot={rightSlot}>
      {!fromVocabulary && (
        <div className='flex items-center gap-2 border-b bg-white px-4 py-2'>
          <div className='mx-auto flex w-full max-w-4xl items-center gap-2'>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={goPrev}
              disabled={!cursor.prev}
              aria-label={t`Previous card`}
            >
              <ArrowLeft className='h-4 w-4' />
            </Button>
            <Button variant='ghost' size='icon-sm' onClick={goNext} disabled={!cursor.next} aria-label={t`Next card`}>
              <ArrowRight className='h-4 w-4' />
            </Button>
          </div>
        </div>
      )}

      <div className='flex-1 overflow-y-auto px-4 py-4'>
        <div className='mx-auto flex max-w-4xl flex-col gap-6'>
          <section>
            <h2 className='mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase'>{t`Card`}</h2>
            <div className='mb-3 flex flex-wrap items-center gap-2'>
              <GrammarChips grammar={card.chunk.grammar} targetLanguage={targetLanguage} />
              <GroundingBadge
                groundedAt={card.chunk.groundedAt}
                grammarUserEditedAt={card.chunk.grammarUserEditedAt}
                targetLanguage={targetLanguage}
              />
            </div>
            {/* Remount when the card mutates server-side (e.g. chat called
                update_card_fields) so the field useState picks up new values. */}
            <EditableCardFields
              key={`${card.id}:${card.updatedAt}`}
              card={card}
              sameLanguage={sameLanguage}
              sourceSessionId={sourceSessionId}
            />
            <div className='mt-4'>
              <EditableGrammarPanel
                key={`grammar:${card.chunk.id}:${card.updatedAt}`}
                card={card}
                targetLanguage={targetLanguage}
                sourceSessionId={sourceSessionId}
              />
            </div>
          </section>

          <section>
            {session?.textTrackId && session.contentSourceType !== 'adhoc' && (
              <SurroundingContextBlock
                sessionId={sessionId}
                textTrackId={session.textTrackId}
                segmentId={card.segmentId}
                fromVocabulary={fromVocabulary}
              />
            )}
            <h2 className='mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase'>{t`Full exploration`}</h2>
            {hasExtras ? (
              <FullExplorationRenderer card={card} />
            ) : (
              <div className='flex flex-col items-start gap-3'>
                <p className='text-muted-foreground text-sm'>
                  {isExploring
                    ? t`Generating full exploration… this takes a few seconds.`
                    : hasBasicData
                      ? t`Click Generate full exploration to enrich this card with collocations, etymology, register, IPA, and more.`
                      : t`This card looks incomplete. Re-process the session to populate its basic data, then come back to enrich it.`}
                </p>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => exploreCard({ cardId: card.id })}
                  disabled={isExploring}
                >
                  <Sparkles className='mr-1 h-4 w-4' />
                  {isExploring ? t`Generating…` : t`Generate full exploration`}
                </Button>
              </div>
            )}
          </section>

          <section>
            <h2 className='mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase'>{t`Chat`}</h2>
            <PerCardChat key={card.id} cardId={card.id} sessionId={sourceSessionId} />
          </section>
        </div>
      </div>
    </ModalScreen>
  )
}
