import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ExternalLink, Sparkles, Star, X } from 'lucide-react'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import { buildWiktionaryUrl } from '@flicktionary/core/utils/wiktionary-url'
import {
  useExploreCard,
  useGetCard,
  useListCardsBySession,
  useTextSegmentsWindow,
  useUpdateCardStatus,
} from '../api/review-hooks'
import { useSetLearningMode } from '@/features/vocabulary/api/vocabulary-hooks'
import { useGetStudySession, useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { FullExplorationRenderer } from './full-exploration-renderer'
import { EditableCardFields } from './editable-card-fields'
import { EditableGrammarPanel } from './editable-grammar-panel'
import { GrammarChips } from './grammar-chips'
import { GroundingBadge } from './grounding-badge'
import { PerCardChat } from './per-card-chat'
import { buildKeptCardCursor } from '../hooks/use-card-list-cursor'
import { useFocusKeyboardNav } from '../hooks/focus-keyboard-nav'
import { getShowTranslationsEnabledForLanguage } from '@/features/sessions/utils/show-translations-pref'

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
  const { from, source, practiceSessionId } = useSearch({
    from: '/_authenticated/_app/sessions/$sessionId/review/$cardId',
  })
  const fromVocabulary = from === 'vocabulary'
  const fromPractice = from === 'practice'
  // Practice & Vocabulary entries are language-wide views over kept chunks,
  // not session-scoped triage queues — same loading shortcut applies.
  const shouldLoadSessionScope = (!fromVocabulary && !fromPractice) || source === 'available'

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
  const { mutate: setLearningMode, isPending: isSettingLearningMode } = useSetLearningMode()
  const { mutate: exploreCard, isPending: isExploringAny, variables: exploringVariables } = useExploreCard()
  const isExploring = isExploringAny && exploringVariables?.cardId === cardId

  const cursor = useMemo(() => buildKeptCardCursor(cards ?? [], cardId), [cards, cardId])

  // Preserve the `from` origin across prev/next so the close button still
  // knows where to land after the user navigates around. Practice carries
  // an additional practiceSessionId so the back-route resolves.
  const search = from ? (fromPractice && practiceSessionId ? { from, practiceSessionId } : { from }) : undefined
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

  // Brief "pressed" highlight before auto-advance: optimistic cache updates only
  // flip `status`, not `learning_mode`, so we can't rely on derived state alone
  // for the visual confirmation. Reset on cardId change so the next card mounts
  // with a clean slate. Declared above the early returns to keep hook order
  // stable across loading/empty states.
  const [pendingAction, setPendingAction] = useState<'reject' | 'passive' | 'active' | null>(null)
  useEffect(() => {
    setPendingAction(null)
  }, [cardId])

  const closeToTriage = () => {
    if (from === 'vocabulary') {
      void navigate({ to: '/vocabulary' })
      return
    }
    if (from === 'practice' && practiceSessionId) {
      void navigate({ to: '/practice/$practiceSessionId', params: { practiceSessionId } })
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

  const hasExtras = Object.keys(card.chunk.explorationExtras ?? {}).length > 0
  const hasBasicData = !!(
    (card.chunk.translation && card.chunk.translation.trim().length > 0) ||
    (card.chunk.definition && card.chunk.definition.trim().length > 0) ||
    (card.chunk.targetExample && card.chunk.targetExample.trim().length > 0)
  )
  const targetLanguage = session?.targetLanguage ?? card.chunk.targetLanguage
  // Live user pref wins over the session snapshot — if the user changed their
  // L1 after creating the session, what they expect now is the live value.
  const nativeLanguage = userPrefs?.nativeLanguage ?? session?.nativeLanguage ?? null
  // Wiktionary-grounded IPA. When set, the full-exploration renderer must
  // suppress its own `extras.ipa` so we don't show pronunciation twice.
  const displayedIpa = pickIpa(card.chunk.grammar?.ipa, targetLanguage, userPrefs?.englishIpaDialect ?? 'ga')
  const wiktionaryUrl = buildWiktionaryUrl(card.chunk.headword, targetLanguage, card.chunk.grammar?.pos)
  const sameLanguage = !!nativeLanguage && nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  const hideTranslationFields = sameLanguage || !getShowTranslationsEnabledForLanguage(userPrefs, targetLanguage)
  const showL1Notes = !!nativeLanguage && !sameLanguage
  const cardPosition = cursor.index + 1
  const cardTotal = cursor.total
  const positionLabel = cursor.index >= 0 ? t`Card ${cardPosition} of ${cardTotal}` : t`Standalone`
  const sourceSessionId = shouldLoadSessionScope ? card.studySessionId : undefined
  // Vocabulary + Practice entries are already kept by definition, so the
  // keep/reject toggles and the per-session position counter don't apply.
  // Show the chunk's headword as the title instead.
  const isLanguageWideEntry = fromVocabulary || fromPractice
  const title = isLanguageWideEntry ? card.chunk.headword : positionLabel

  // Advance to the next card on a triage decision; if we're on the last card,
  // bounce back to the triage list so the user isn't stranded.
  const advanceOrClose = () => {
    if (cursor.next) goNext()
    else closeToTriage()
  }

  const triggerAction = (action: 'reject' | 'passive' | 'active') => {
    if (pendingAction) return
    setPendingAction(action)
    if (action === 'reject') {
      if (card.status !== 'rejected') updateStatus({ cardId: card.id, status: 'rejected' })
    } else if (action === 'passive') {
      if (card.status !== 'kept' || card.chunk.learningMode !== 'passive') {
        updateStatus({ cardId: card.id, status: 'kept', learningMode: 'passive' })
      }
    } else {
      if (card.status !== 'kept' || card.chunk.learningMode !== 'active') {
        updateStatus({ cardId: card.id, status: 'kept', learningMode: 'active' })
      }
    }
    setTimeout(() => advanceOrClose(), 220)
  }

  return (
    <ModalScreen onClose={closeToTriage} closeIcon='chevron' title={title}>
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
              {wiktionaryUrl && (
                <a
                  href={wiktionaryUrl}
                  target='_blank'
                  rel='noreferrer'
                  className='text-foreground hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors'
                >
                  <ExternalLink className='h-3 w-3' />
                  {t`Wiktionary`}
                </a>
              )}
            </div>
            {/* Remount when the card mutates server-side (e.g. chat called
                update_card_fields) so the field useState picks up new values. */}
            <EditableCardFields
              key={`${card.id}:${card.updatedAt}`}
              card={card}
              hideTranslationFields={hideTranslationFields}
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
              <FullExplorationRenderer
                card={card}
                hideExtrasIpa={!!displayedIpa}
                hideTranslationFields={hideTranslationFields}
                showL1Notes={showL1Notes}
              />
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

      {isLanguageWideEntry && (
        <div className='shrink-0 border-t bg-white px-4 py-3'>
          <div className='mx-auto flex w-full max-w-4xl flex-col gap-2'>
            <Button
              variant={card.chunk.learningMode === 'active' ? 'default' : 'outline'}
              size='xl'
              className='w-full'
              disabled={isSettingLearningMode}
              onClick={() => {
                setLearningMode(
                  { chunkId: card.chunk.id, learningMode: 'active' },
                  {
                    onSuccess: () => {
                      if (from === 'vocabulary') void navigate({ to: '/vocabulary' })
                      else if (from === 'practice' && practiceSessionId) {
                        void navigate({
                          to: '/practice/$practiceSessionId',
                          params: { practiceSessionId },
                        })
                      }
                    },
                  }
                )
              }}
            >
              <Star className='mr-2 h-4 w-4' />
              {t`Add to active vocabulary`}
            </Button>
            <Button
              variant={card.chunk.learningMode === 'passive' ? 'default' : 'outline'}
              size='xl'
              className='w-full'
              disabled={isSettingLearningMode}
              onClick={() => {
                setLearningMode(
                  { chunkId: card.chunk.id, learningMode: 'passive' },
                  {
                    onSuccess: () => {
                      if (from === 'vocabulary') void navigate({ to: '/vocabulary' })
                      else if (from === 'practice' && practiceSessionId) {
                        void navigate({
                          to: '/practice/$practiceSessionId',
                          params: { practiceSessionId },
                        })
                      }
                    },
                  }
                )
              }}
            >
              {t`Add to passive vocabulary`}
            </Button>
          </div>
        </div>
      )}

      {!isLanguageWideEntry && (
        <>
          {/* Side-edge nav arrows: fixed to the viewport at mid-height so they
              stay reachable while the user scrolls long cards. Solid white +
              stronger border/shadow so they read clearly against text; chunkier
              touch target on mobile. */}
          <button
            type='button'
            onClick={goPrev}
            disabled={!cursor.prev}
            aria-label={t`Previous card`}
            className='fixed top-1/2 left-3 z-30 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-gray-300 bg-white shadow-lg transition hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-30 md:h-11 md:w-11'
          >
            <ArrowLeft className='h-6 w-6' />
          </button>
          <button
            type='button'
            onClick={goNext}
            disabled={!cursor.next}
            aria-label={t`Next card`}
            className='fixed top-1/2 right-3 z-30 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-gray-300 bg-white shadow-lg transition hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-30 md:h-11 md:w-11'
          >
            <ArrowRight className='h-6 w-6' />
          </button>

          <FocusActionBar
            card={card}
            pendingAction={pendingAction}
            onReject={() => triggerAction('reject')}
            onKeepPassive={() => triggerAction('passive')}
            onKeepActive={() => triggerAction('active')}
          />
        </>
      )}
    </ModalScreen>
  )
}

type FocusActionBarProps = {
  card: {
    status: 'pending' | 'kept' | 'rejected' | 'auto_rejected'
    chunk: { learningMode: 'passive' | 'active' }
  }
  // When set, overrides the state-derived highlight so the just-tapped button
  // stays filled during the brief delay before navigation.
  pendingAction: 'reject' | 'passive' | 'active' | null
  onReject: () => void
  onKeepPassive: () => void
  onKeepActive: () => void
}

const FocusActionBar = ({ card, pendingAction, onReject, onKeepPassive, onKeepActive }: FocusActionBarProps) => {
  const { t } = useLingui()
  const isRejected = pendingAction
    ? pendingAction === 'reject'
    : card.status === 'rejected' || card.status === 'auto_rejected'
  const isKeptPassive = pendingAction
    ? pendingAction === 'passive'
    : card.status === 'kept' && card.chunk.learningMode === 'passive'
  const isKeptActive = pendingAction
    ? pendingAction === 'active'
    : card.status === 'kept' && card.chunk.learningMode === 'active'

  return (
    <div className='shrink-0 border-t bg-white px-4 py-3'>
      <div className='mx-auto flex w-full max-w-4xl items-stretch gap-2'>
        <Button size='xl' variant={isRejected ? 'destructive' : 'outline'} className='flex-1' onClick={onReject}>
          <X className='mr-1 h-4 w-4' />
          {t`Reject`}
        </Button>
        <Button size='xl' variant={isKeptPassive ? 'default' : 'outline'} className='flex-1' onClick={onKeepPassive}>
          {t`Passive`}
        </Button>
        <Button size='xl' variant={isKeptActive ? 'default' : 'outline'} className='flex-1' onClick={onKeepActive}>
          <Star className='mr-1 h-4 w-4' />
          {t`Active`}
        </Button>
      </div>
    </div>
  )
}
