import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { RateButtons, type RateValue } from '@/components/ui/rate-buttons'
import { EnglishIpaDialectFlag } from '@/components/english-ipa-dialect-flag'
import { GrammarChips } from '@/features/review/components/grammar-chips'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getShowTranslationsEnabledForLanguage } from '@/features/sessions/utils/show-translations-pref'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import {
  getCardFaceConfig,
  resolveCardSlots,
  type CardSlotConditions,
  type CardSlotKey,
} from '@flicktionary/core/constants/card-face-config'
import type { Flashcard } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { StressMarkedText } from './stress-marked-text'
import { PracticeLoader } from './practice-loader'
import { useFlashcards, useRateFlashcard } from '../api/practice-hooks'

// A persistently-failing rateFlashcard mutation re-appends its card to the
// queue end (so it isn't silently lost) — capped so a hard failure can't loop
// forever.
const MAX_RATE_RETRIES = 2

type QueueItem = {
  card: Flashcard
  // Times this card has been re-appended after a mutation error.
  retryCount: number
  // Whether this card has already been re-appended once for an 'again' rating.
  // A single capped redrill avoids FSRS thrash / infinite loops.
  requeuedForAgain: boolean
}

export const FlashcardSessionView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/flashcards/$targetLanguage' })
  const { data: userPrefs } = useGetUserPrefs()
  const { data: cards, isLoading } = useFlashcards(targetLanguage)
  const { mutate: rateFlashcard } = useRateFlashcard()

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [capNoticeShown, setCapNoticeShown] = useState(false)
  const seededRef = useRef(false)

  // Seed the working queue once, from the first successful fetch. Re-appends
  // (for 'again' redrills and error retries) mutate `queue` afterwards, so the
  // Done screen is only reached when the whole working queue is exhausted.
  useEffect(() => {
    if (seededRef.current || !cards) return
    seededRef.current = true
    setQueue(cards.map((card) => ({ card, retryCount: 0, requeuedForAgain: false })))
  }, [cards])

  const close = () => void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })

  const languageName = getLanguageName(targetLanguage)
  const current = queue[index]

  const handleRate = (rating: RateValue) => {
    const item = queue[index]
    if (!item) return
    const { card } = item

    // Advance the UI immediately for responsiveness; the mutation runs in the
    // background with a safety net so a failure doesn't silently drop the card.
    setRevealed(false)
    setIndex((i) => i + 1)

    rateFlashcard(
      { userLookupId: card.userLookupId, rating },
      {
        onSuccess: (resp) => {
          // New-card intro refused by the daily cap: drop it (no re-queue) and
          // surface a one-time note.
          if (resp.data.dailyCapReached) {
            if (!capNoticeShown) setCapNoticeShown(true)
            return
          }
          // Single capped 'again' redrill — only after the rating is accepted.
          // A refused daily-cap intro or failed mutation should not add the
          // normal redrill copy on top of its own handling path.
          if (rating === 'again' && !item.requeuedForAgain) {
            setQueue((q) => [...q, { card, retryCount: item.retryCount, requeuedForAgain: true }])
          }
        },
        onError: () => {
          // useRateFlashcard already toasts via meta.errorMessage. Re-append so
          // the user re-rates before Done — capped to avoid an infinite loop.
          if (item.retryCount < MAX_RATE_RETRIES) {
            setQueue((q) => [...q, { card, retryCount: item.retryCount + 1, requeuedForAgain: item.requeuedForAgain }])
          }
        },
      }
    )
  }

  if (isLoading) {
    return (
      <ModalScreen onClose={close} title={languageName}>
        <PracticeLoader label={t`Loading flashcards…`} />
      </ModalScreen>
    )
  }

  // Done: queue exhausted (also the empty-batch / nothing-due case).
  if (!current) {
    return (
      <ModalScreen onClose={close} title={languageName}>
        <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
          <CircleCheck className='h-10 w-10 text-emerald-600' />
          <p className='text-lg font-semibold'>
            {queue.length === 0 ? t`No flashcards are due right now.` : t`All done!`}
          </p>
          {capNoticeShown && <p className='text-muted-foreground text-sm'>{t`Daily new-card limit reached.`}</p>}
          <Button type='button' size='lg' onClick={close}>
            {t`Back to ${languageName}`}
          </Button>
        </div>
      </ModalScreen>
    )
  }

  // Build the runtime conditions exactly like rate-sheet.tsx's back-side logic.
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
    // Over-include is harmless: GrammarChips self-hides when no chips qualify.
    hasGrammarChips: !!card.grammar,
  }

  const faceConfig = getCardFaceConfig(targetLanguage)
  const frontSlots = resolveCardSlots(faceConfig.front, cond)
  const backSlots = resolveCardSlots(faceConfig.back, cond)

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
    <ModalScreen onClose={close} title={languageName}>
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex-1 overflow-y-auto'>
          <div className='mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-8 text-center'>
            {frontSlots.map(renderSlot)}
            {revealed && (
              <>
                <div className='my-2 w-full border-t' />
                {backSlots.map(renderSlot)}
              </>
            )}
          </div>
        </div>
        <div className='border-t bg-white px-4 py-3'>
          <div className='mx-auto w-full max-w-xl'>
            {revealed ? (
              <RateButtons onSelect={handleRate} />
            ) : (
              <Button type='button' size='xl' className='w-full' onClick={() => setRevealed(true)}>
                {t`Show answer`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </ModalScreen>
  )
}
