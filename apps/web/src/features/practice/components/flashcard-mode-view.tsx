import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, CircleCheck, Dumbbell } from 'lucide-react'
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

// Russian display forms carry a combining acute (U+0301) marking stress
// (e.g. находи́ться). Languages with hideStressOnFront strip it on the front
// so the pronunciation isn't given away before the reveal.
const stripStressMarks = (text: string) => text.replace(/\u0301/g, '')

type QueueItem = {
  card: ReviewTerm
  retryCount: number
  // True for in-session redrill copies of 'again'-rated cards (classifies the
  // item into the learning bucket of the remaining counts).
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
  // Mirror of `index` for async rate callbacks: rolling back an optimistic
  // redrill copy must know whether the copy was already consumed.
  const indexRef = useRef(0)
  const [revealed, setRevealed] = useState(false)
  const [capNoticeShown, setCapNoticeShown] = useState(false)
  // Peek-back: how many cards behind the live index we're re-viewing read-only.
  const [peekBack, setPeekBack] = useState(0)
  const seededRef = useRef(false)
  // Terms rated again/hard this session — offered post-session Strengthen
  // exercises. Parked (leech) terms never enter this queue, so the set is
  // non-leech by construction.
  const sessionHardRef = useRef<Set<string>>(new Set())

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
    indexRef.current += 1

    if (rating === 'again' || rating === 'hard') {
      sessionHardRef.current.add(card.userLookupId)
    }

    // Anki-style: an 'again' card keeps coming back until it gets a
    // non-'again' rating. Because every non-'again' passive rating is
    // clamped to >= +24h, redrilling until passed guarantees a finished
    // session leaves nothing immediately due — no straggler follow-ups
    // resurfacing right after the post-session Strengthen round. The
    // loop is user-controlled (rate it 'hard'+ to move on), and terms
    // that keep lapsing across sessions get parked by the leech path.
    //
    // The redrill copy is appended in the same render as the index advance —
    // requeueing on mutation success made the Learning pill dip and bounce
    // back a beat later. Rolled back (by identity) on the outcomes that must
    // not redrill: cap-rejected rating, leech parking, mutation error.
    const redrill: QueueItem | null =
      rating === 'again' ? { card, retryCount: item.retryCount, requeuedForAgain: true } : null
    if (redrill) setQueue((q) => [...q, redrill])
    const dropRedrill = () => {
      if (!redrill) return
      setQueue((q) => {
        const position = q.indexOf(redrill)
        // Already consumed (re-rated before the response landed): removing it
        // now would shift the queue under the live index onto the wrong card.
        if (position === -1 || position < indexRef.current) return q
        return q.filter((queued) => queued !== redrill)
      })
    }

    rateTerm(
      { userLookupId: card.userLookupId, rating, pool },
      {
        onSuccess: (resp) => {
          if (resp.data.dailyCapReached) {
            dropRedrill()
            if (!capNoticeShown) setCapNoticeShown(true)
            return
          }
          if (resp.data.parked) {
            // The term crossed the leech threshold and left every practice
            // queue — don't redrill it in-session; rehab gates bring it back.
            dropRedrill()
            const headword = card.headword
            toast.info(t`“${headword}” keeps tripping you up — it's parked for rehab exercises.`)
          }
        },
        onError: () => {
          dropRedrill()
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
    const sessionHard = [...sessionHardRef.current]
    const hardCount = sessionHard.length
    const openStrengthen = () =>
      void navigate({
        to: '/practice/strengthen/$targetLanguage',
        params: { targetLanguage },
        search: { pool, sessionHard },
      })
    return (
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
          <CircleCheck className='h-10 w-10 text-emerald-600' />
          <p className='text-lg font-semibold'>{queue.length === 0 ? t`No terms are due right now.` : t`All done!`}</p>
          {capNoticeShown && <p className='text-muted-foreground text-sm'>{t`Daily new-card limit reached.`}</p>}
          {sessionHard.length > 0 && (
            <p className='text-muted-foreground text-sm'>
              {t`${hardCount} term(s) gave you trouble. A quick exercise round can lock them in — optional.`}
            </p>
          )}
        </div>
        <div className='bg-background border-t px-4 pt-2 pb-3'>
          <div className='mx-auto flex w-full max-w-xl flex-col gap-2'>
            {sessionHard.length > 0 ? (
              <>
                <Button type='button' size='xl' className='w-full' onClick={openStrengthen}>
                  <Dumbbell className='h-4 w-4' />
                  {t`Strengthen`}
                </Button>
                <Button type='button' variant='outline' size='xl' className='w-full' onClick={close}>
                  {t`Back to ${languageName}`}
                </Button>
              </>
            ) : (
              <Button type='button' size='xl' className='w-full' onClick={close}>
                {t`Back to ${languageName}`}
              </Button>
            )}
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

  // "Study this exact form": when enabled on the chunk, the front drills the
  // inflected form (grammar.studied_form.form) instead of the lemma; the back
  // leads with the form's in-context translation and demotes the lemma + its
  // translation to a secondary line. The lemma's IPA is suppressed — it would
  // be wrong for the inflected form.
  const studiedForm =
    card.grammar?.study_form_enabled && card.grammar?.studied_form?.form ? card.grammar.studied_form : null

  const cond: CardSlotConditions = {
    hideTranslationFields,
    hasIpa: !!ipa && !studiedForm,
    hasTargetExample: !!card.targetExample,
    hasNativeExample: !!card.nativeExample,
    hasTranslation: studiedForm ? !!studiedForm.translation : !!card.translation,
    hasDefinition: !!card.definition,
    hasGrammarChips: !!card.grammar,
  }

  // Active fronts are gloss-only; a card with no translation, no definition
  // and no example translation would render a blank front — fall back to the
  // recognition (passive) layout for that card.
  const poolConfig = getCardFaceConfig(targetLanguage, pool)
  const poolFront = resolveCardSlots(poolConfig.front, cond)
  const faceConfig = poolFront.length > 0 ? poolConfig : getCardFaceConfig(targetLanguage, 'passive')
  const frontSlots = poolFront.length > 0 ? poolFront : resolveCardSlots(faceConfig.front, cond)
  const backSlots = resolveCardSlots(faceConfig.back, cond)
  // Peeked cards are always shown fully (front + back), read-only.
  const showBack = revealed || isPeeking

  const renderSlot = (slot: CardSlotKey, face: 'front' | 'back') => {
    switch (slot) {
      case 'headword': {
        const fullForm = studiedForm ? studiedForm.form : card.grammar?.display_form || card.headword
        return (
          <StressMarkedText
            key='headword'
            text={faceConfig.hideStressOnFront && !showBack ? stripStressMarks(fullForm) : fullForm}
            lang={targetLanguage}
            className='text-2xl font-bold'
          />
        )
      }
      case 'ipa':
        return ipa ? (
          <div key='ipa' className='text-muted-foreground flex items-center justify-center gap-1.5 text-base'>
            <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />
            <span>{ipa}</span>
          </div>
        ) : null
      case 'targetExample':
        return card.targetExample ? (
          <p key='targetExample' className='border-l-2 border-yellow-300 pl-3 text-left text-base'>
            {card.targetExample}
          </p>
        ) : null
      case 'nativeExample':
        return card.nativeExample ? (
          <p key='nativeExample' className='text-muted-foreground pl-3 text-left text-base'>
            {card.nativeExample}
          </p>
        ) : null
      case 'translation': {
        const primaryTranslation = studiedForm ? studiedForm.translation : card.translation
        return primaryTranslation ? (
          <p key='translation' className='text-lg'>
            {primaryTranslation}
          </p>
        ) : null
      }
      case 'definition':
        // On an active front the definition is the prompt itself (translation
        // fallback), so it gets prompt sizing instead of footnote sizing.
        return card.definition ? (
          <p key='definition' className={face === 'front' ? 'text-lg' : 'text-muted-foreground text-sm'}>
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
          {frontSlots.map((slot) => renderSlot(slot, 'front'))}
          {showBack && (
            <>
              <div className='my-2 w-full border-t' />
              {studiedForm && (
                <p className='text-muted-foreground text-sm'>
                  <StressMarkedText
                    text={card.grammar?.display_form || card.headword}
                    lang={targetLanguage}
                    className='font-medium'
                  />
                  {card.translation ? ` — ${card.translation}` : null}
                </p>
              )}
              {backSlots.map((slot) => renderSlot(slot, 'back'))}
            </>
          )}
        </div>
      </div>
      <div className='bg-background border-t px-4 py-3'>
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
