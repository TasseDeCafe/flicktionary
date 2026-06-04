import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight, CircleCheck } from 'lucide-react'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { RateButtons, type RateValue } from '@flicktionary/ui/components/rate-buttons'
import { EnglishIpaDialectFlag } from '@/components/english-ipa-dialect-flag'
import { GrammarChips } from '@/features/review/components/grammar-chips'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getShowTranslationsEnabledForLanguage } from '@/features/sessions/utils/show-translations-pref'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import {
  getCardFaceConfig,
  resolveCardSlots,
  type CardSlotConditions,
  type CardSlotKey,
} from '@flicktionary/core/constants/card-face-config'
import type {
  PracticePool,
  ReviewScope,
  ReviewTerm,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { StressMarkedText } from './stress-marked-text'
import { PracticeLoader } from './practice-loader'
import { ReviewQueueStats } from './review-queue-stats'
import type { QueueCounts } from './review-counts'
import { useListReviewTerms, useRateTerm } from '../api/practice-hooks'

// A persistently-failing rateTerm mutation re-appends its card to the queue end
// (so it isn't silently lost) — capped so a hard failure can't loop forever.
const MAX_RATE_RETRIES = 2

type QueueItem = {
  card: ReviewTerm
  retryCount: number
  // Whether this card has already been re-appended once for an 'again' rating.
  requeuedForAgain: boolean
}

const getRemainingCounts = (queue: QueueItem[], index: number): QueueCounts =>
  queue.slice(index).reduce<QueueCounts>(
    (counts, item) => {
      if (item.requeuedForAgain) {
        counts.learning += 1
        return counts
      }
      switch (item.card.srsState) {
        case null:
          counts.new += 1
          break
        case 'review':
          counts.review += 1
          break
        case 'new':
        case 'learning':
        case 'relearning':
          counts.learning += 1
          break
      }
      return counts
    },
    { new: 0, learning: 0, review: 0 }
  )

type FlashcardModeViewProps = {
  targetLanguage: string
  pool: PracticePool
  scope: ReviewScope
}

export const FlashcardModeView = ({ targetLanguage, pool, scope }: FlashcardModeViewProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: userPrefs } = useGetUserPrefs()
  const { data: cards, isLoading } = useListReviewTerms(targetLanguage, pool, scope)
  const { mutate: rateTerm } = useRateTerm()
  const languageName = getLanguageName(targetLanguage)
  const close = () => void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [capNoticeShown, setCapNoticeShown] = useState(false)
  // Peek-back: how many cards behind the live index we're re-viewing read-only.
  const [peekBack, setPeekBack] = useState(0)
  const seededRef = useRef(false)

  useEffect(() => {
    if (seededRef.current || !cards) return
    seededRef.current = true
    setQueue(cards.map((card) => ({ card, retryCount: 0, requeuedForAgain: false })))
  }, [cards])

  const remainingCounts = getRemainingCounts(queue, index)
  const isPeeking = peekBack > 0
  const displayedIndex = index - peekBack
  const current = queue[displayedIndex]

  const handleRate = (rating: RateValue) => {
    const item = queue[index]
    if (!item) return
    const { card } = item

    setRevealed(false)
    setIndex((i) => i + 1)

    rateTerm(
      { userLookupId: card.userLookupId, rating, pool },
      {
        onSuccess: (resp) => {
          if (resp.data.dailyCapReached) {
            if (!capNoticeShown) setCapNoticeShown(true)
            return
          }
          if (rating === 'again' && !item.requeuedForAgain) {
            setQueue((q) => [...q, { card, retryCount: item.retryCount, requeuedForAgain: true }])
          }
        },
        onError: () => {
          if (item.retryCount < MAX_RATE_RETRIES) {
            setQueue((q) => [...q, { card, retryCount: item.retryCount + 1, requeuedForAgain: item.requeuedForAgain }])
          }
        },
      }
    )
  }

  if (isLoading) {
    return <PracticeLoader label={t`Loading review terms…`} />
  }

  // Done: live queue exhausted (also the empty-batch / nothing-due case).
  if (!queue[index] && !isPeeking) {
    return (
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
          <CircleCheck className='h-10 w-10 text-emerald-600' />
          <p className='text-lg font-semibold'>{queue.length === 0 ? t`No terms are due right now.` : t`All done!`}</p>
          {capNoticeShown && <p className='text-muted-foreground text-sm'>{t`Daily new-card limit reached.`}</p>}
        </div>
        <div className='border-t bg-white px-4 pt-2 pb-3'>
          <div className='mx-auto w-full max-w-xl'>
            <Button type='button' size='xl' className='w-full' onClick={close}>
              {t`Back to ${languageName}`}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!current) return <PracticeLoader label={t`Loading…`} />

  const card = current.card
  const nativeLanguage = userPrefs?.nativeLanguage ?? null
  const sameLanguage = !!nativeLanguage && nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  const hideTranslationFields = sameLanguage || !getShowTranslationsEnabledForLanguage(userPrefs, targetLanguage)
  const englishIpaDialect = userPrefs?.englishIpaDialect ?? 'ga'
  const ipa = pickIpa(card.grammar?.ipa, targetLanguage, englishIpaDialect)

  const cond: CardSlotConditions = {
    hideTranslationFields,
    hasIpa: !!ipa,
    hasTargetExample: !!card.targetExample,
    hasNativeExample: !!card.nativeExample,
    hasTranslation: !!card.translation,
    hasDefinition: !!card.definition,
    hasGrammarChips: !!card.grammar,
  }

  const faceConfig = getCardFaceConfig(targetLanguage)
  const frontSlots = resolveCardSlots(faceConfig.front, cond)
  const backSlots = resolveCardSlots(faceConfig.back, cond)
  // Peeked cards are always shown fully (front + back), read-only.
  const showBack = revealed || isPeeking

  const renderSlot = (slot: CardSlotKey) => {
    switch (slot) {
      case 'headword':
        return (
          <StressMarkedText
            key='headword'
            text={card.grammar?.display_form || card.headword}
            lang={targetLanguage}
            className='text-2xl font-bold'
          />
        )
      case 'ipa':
        return ipa ? (
          <div key='ipa' className='text-muted-foreground flex items-center justify-center gap-1.5 text-sm'>
            <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />
            <span>{ipa}</span>
          </div>
        ) : null
      case 'targetExample':
        return card.targetExample ? (
          <p key='targetExample' className='border-l-2 border-yellow-300 pl-3 text-left text-sm italic'>
            {card.targetExample}
          </p>
        ) : null
      case 'nativeExample':
        return card.nativeExample ? (
          <p key='nativeExample' className='text-muted-foreground pl-3 text-left text-sm not-italic'>
            {card.nativeExample}
          </p>
        ) : null
      case 'translation':
        return card.translation ? (
          <p key='translation' className='text-lg'>
            {card.translation}
          </p>
        ) : null
      case 'definition':
        return card.definition ? (
          <p key='definition' className='text-muted-foreground text-sm'>
            {card.definition}
          </p>
        ) : null
      case 'grammar':
        return (
          <div key='grammar' className='flex justify-center'>
            <GrammarChips grammar={card.grammar} targetLanguage={targetLanguage} />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-8 text-center'>
          {frontSlots.map(renderSlot)}
          {showBack && (
            <>
              <div className='my-2 w-full border-t' />
              {backSlots.map(renderSlot)}
            </>
          )}
        </div>
      </div>
      <div className='border-t bg-white px-4 py-3'>
        <div className='mx-auto flex w-full max-w-xl flex-col gap-3'>
          <div className='flex items-center justify-between gap-2'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={t`Previous card`}
              disabled={displayedIndex <= 0}
              onClick={() => setPeekBack((p) => p + 1)}
            >
              <ChevronLeft className='h-5 w-5' />
            </Button>
            <ReviewQueueStats counts={remainingCounts} />
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={t`Forward`}
              disabled={!isPeeking}
              onClick={() => setPeekBack((p) => Math.max(0, p - 1))}
            >
              <ChevronRight className='h-5 w-5' />
            </Button>
          </div>
          {isPeeking ? (
            <Button type='button' size='xl' variant='outline' className='w-full' onClick={() => setPeekBack(0)}>
              {t`Back to current card`}
            </Button>
          ) : showBack ? (
            <RateButtons onSelect={handleRate} />
          ) : (
            <Button type='button' size='xl' className='w-full' onClick={() => setRevealed(true)}>
              {t`Show answer`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
