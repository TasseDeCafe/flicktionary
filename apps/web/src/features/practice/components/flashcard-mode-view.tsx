import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { BadgeCheck, ChevronLeft, ChevronRight, CircleCheck, Dumbbell, MoreVertical, Volume2 } from 'lucide-react'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { RateButtons, type RateValue } from '@flicktionary/ui/components/rate-buttons'
import { EnglishIpaDialectFlag } from '@/components/english-ipa-dialect-flag'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { GrammarChips } from '@/features/review/components/grammar-chips'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getShowTranslationsEnabledForLanguage } from '@/features/sessions/utils/show-translations-pref'
import { pickIpaForDisplay } from '@flicktionary/core/utils/pick-ipa'
import { stripStressMarks } from '@flicktionary/core/utils/strip-stress-marks'
import {
  getCardFaceConfig,
  resolveCardSlots,
  type CardSlotConditions,
  type CardSlotKey,
} from '@flicktionary/core/constants/card-face-config'
import type {
  Grammar,
  PracticePool,
  ReviewScope,
  ReviewTerm,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { resolveCardContent } from '../utils/resolve-card-content'
import { ReviewQueueStats } from './review-queue-stats'
import { FlashcardActionsOverlay } from './flashcard-actions-overlay'
import type { QueueCounts } from './review-counts'
import { useListReviewTerms, useRateTerm, useUndoRating } from '../api/practice-hooks'

// A persistently-failing rateTerm mutation re-appends its card to the queue end
// (so it isn't silently lost) — capped so a hard failure can't loop forever.
const MAX_RATE_RETRIES = 2

type QueueItem = {
  card: ReviewTerm
  retryCount: number
  // True for in-session redrill copies of 'again'-rated cards (classifies the
  // item into the learning bucket of the remaining counts).
  requeuedForAgain: boolean
}

// One durably-applied rating, keyed by the QueueItem it rated (object
// identity — same identity scheme as the redrill machinery). `eventId` is the
// undo handle the rating response returned; `redrill` is the in-session copy
// an 'again' rating appended (null otherwise), so a re-rate can reconcile it.
type RatingRecord = {
  rating: RateValue
  eventId: string
  redrill: QueueItem | null
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

// Mirrors the card body (centered prompt + example lines) and the bottom bar
// (nav chevrons + queue-stat pills + the full-width "Show answer" button) so the
// reviewer doesn't jump when the queue lands.
const FlashcardSkeleton = () => (
  <div className='flex flex-1 flex-col overflow-hidden'>
    <div className='flex-1 overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-8'>
        <Skeleton className='h-8 w-56' />
        <Skeleton className='h-5 w-full max-w-md' />
        <Skeleton className='h-5 w-3/4 max-w-md' />
      </div>
    </div>
    <div className='bg-background border-t px-4 py-3'>
      <div className='mx-auto flex w-full max-w-xl flex-col gap-3'>
        <div className='flex items-center justify-between gap-2'>
          <Skeleton className='h-9 w-9 rounded-md' />
          <div className='flex gap-2'>
            <Skeleton className='h-6 w-16 rounded-full' />
            <Skeleton className='h-6 w-20 rounded-full' />
            <Skeleton className='h-6 w-16 rounded-full' />
          </div>
          <Skeleton className='h-9 w-9 rounded-md' />
        </div>
        <Skeleton className='h-12 w-full' />
      </div>
    </div>
  </div>
)

type FlashcardModeViewProps = {
  targetLanguage: string
  pool: PracticePool
  scope: ReviewScope
  // Explicit learn-new batch size (learn_new scope only) — picked on the
  // landing's batch sheet, forwarded to listReviewTerms as newBatchSize.
  count?: number
}

export const FlashcardModeView = ({ targetLanguage, pool, scope, count }: FlashcardModeViewProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: userPrefs } = useGetUserPrefs()
  const { data: cards, isLoading } = useListReviewTerms(targetLanguage, pool, scope, count)
  const { mutate: rateTerm } = useRateTerm()
  const { mutate: undoRating } = useUndoRating()
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
  // Durably-applied ratings keyed by QueueItem identity: an entry exists ⇔
  // the rating landed server-side with an undoable event. Drives the peek
  // re-rate buttons. A ref (not state): writes happen in mutation callbacks
  // and reads happen in renders triggered by the same queue/index updates.
  const ratingRecordsRef = useRef<Map<QueueItem, RatingRecord>>(new Map())
  // The peeked item whose undo→re-rate chain is in flight (disables the peek
  // rate buttons until the chain settles).
  const [pendingRerate, setPendingRerate] = useState<QueueItem | null>(null)
  // Header-kebab actions menu for the displayed card (edit term, …).
  const [actionsOpen, setActionsOpen] = useState(false)

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
    // non-'again' rating. Because every non-'again' recognition rating is
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
      // learnNewSession lets introductions in an explicit learn-new session
      // bypass the daily-new cap (they still count toward today's intros).
      // Gated on `count` to mirror the fetch-time bypass (requestedNewCount):
      // only the batch-sheet flow supplies it, so a direct/bookmarked
      // learn_new URL without a chosen batch stays within the daily budget at
      // rating time too.
      {
        userLookupId: card.userLookupId,
        rating,
        pool,
        // Facet identity of the queued card (citation in Phase 2; carried so
        // pronunciation/form cards address the right facet in Phase 4).
        skill: card.skill,
        targetForm: card.targetForm,
        learnNewSession: scope === 'learn_new' && count != null,
      },
      {
        onSuccess: (resp) => {
          if (resp.data.dailyCapReached) {
            // Nothing applied (no event) — no record, nothing to re-rate.
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
            // parked comes in two shapes: eventId set = the rating applied AND
            // newly parked the leech (fully undoable — undo un-parks); eventId
            // null = stale-queue no-op on an already-parked term (nothing to
            // undo). Only the former gets a record.
            if (resp.data.eventId) {
              ratingRecordsRef.current.set(item, { rating, eventId: resp.data.eventId, redrill })
            }
            return
          }
          if (resp.data.eventId) {
            ratingRecordsRef.current.set(item, { rating, eventId: resp.data.eventId, redrill })
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

  // Peek re-rate (Anki semantics): undo the recorded rating, then apply the
  // new one through the full rateTerm machinery (cap/introduction/leech). Any
  // outcome that leaves the card unrated server-side (stale undo, cap refusal,
  // parked no-op, error after a committed undo) drops the record and
  // re-appends a fresh QueueItem so the card resurfaces rateable.
  const handleRerate = (item: QueueItem, newRating: RateValue) => {
    const record = ratingRecordsRef.current.get(item)
    if (!record || pendingRerate) return
    const { card } = item
    setPendingRerate(item)

    const requeueFresh = () => {
      ratingRecordsRef.current.delete(item)
      setQueue((q) => [...q, { card, retryCount: 0, requeuedForAgain: false }])
    }

    undoRating(
      {
        userLookupId: card.userLookupId,
        pool,
        skill: card.skill,
        targetForm: card.targetForm,
        eventId: record.eventId,
      },
      {
        // Mutation error: nothing changed server-side — keep the record (the
        // hook's meta toast surfaces the failure).
        onError: () => setPendingRerate(null),
        onSuccess: (undoResp) => {
          if (!undoResp.data.undone) {
            // Stale handle — a later rating (other tab, reading mode) is now
            // the latest live event, or it was already reverted. The server
            // refused to restore; treat the card as unknown-but-consistent:
            // drop the record and let it resurface for a clean rating.
            requeueFresh()
            setPendingRerate(null)
            return
          }
          // Undo committed — the card is unrated server-side. Apply the fresh
          // rating with the same learn-new flag as original ratings.
          rateTerm(
            {
              userLookupId: card.userLookupId,
              rating: newRating,
              pool,
              skill: card.skill,
              targetForm: card.targetForm,
              learnNewSession: scope === 'learn_new' && count != null,
            },
            {
              onError: () => {
                requeueFresh()
                setPendingRerate(null)
              },
              onSuccess: (resp) => {
                const parked = resp.data.parked
                if (resp.data.dailyCapReached || (parked && resp.data.eventId === null)) {
                  // The fresh rating didn't apply (cap consumed meanwhile, or
                  // the term got parked by another surface) — card is unrated.
                  requeueFresh()
                  if (resp.data.dailyCapReached && !capNoticeShown) setCapNoticeShown(true)
                  if (parked) {
                    const headword = card.headword
                    toast.info(t`“${headword}” keeps tripping you up — it's parked for rehab exercises.`)
                  }
                  setPendingRerate(null)
                  return
                }

                // Applied (incl. newly-parked-with-eventId). Reconcile the
                // redrill copy with the rating change.
                const oldRedrill = record.redrill
                let newRedrill: QueueItem | null = oldRedrill
                const dropOldRedrill = () => {
                  if (!oldRedrill) return
                  setQueue((q) => {
                    const position = q.indexOf(oldRedrill)
                    // Already consumed: the live index walked past it — can't
                    // pull a card the session already showed.
                    if (position === -1 || position < indexRef.current) return q
                    return q.filter((queued) => queued !== oldRedrill)
                  })
                  newRedrill = null
                }
                if (parked) {
                  // Newly parked: out of rotation — no redrill either way.
                  dropOldRedrill()
                  const headword = card.headword
                  toast.info(t`“${headword}” keeps tripping you up — it's parked for rehab exercises.`)
                } else if (record.rating === 'again' && newRating !== 'again') {
                  dropOldRedrill()
                } else if (record.rating !== 'again' && newRating === 'again') {
                  const fresh: QueueItem = { card, retryCount: item.retryCount, requeuedForAgain: true }
                  setQueue((q) => [...q, fresh])
                  newRedrill = fresh
                }

                // Keyed by lookupId — may over-clear when a redrill copy is
                // still hard; acceptable, Strengthen is best-effort.
                if (newRating === 'again' || newRating === 'hard') {
                  sessionHardRef.current.add(card.userLookupId)
                } else {
                  sessionHardRef.current.delete(card.userLookupId)
                }

                ratingRecordsRef.current.set(item, {
                  rating: newRating,
                  eventId: resp.data.eventId as string,
                  redrill: newRedrill,
                })
                setPeekBack(0)
                setPendingRerate(null)
              },
            }
          )
        },
      }
    )
  }

  // The view owns its ModalScreen (instead of unified-review-view) so the
  // header's kebab can be card-aware: present only while a card is displayed.
  const wrap = (children: React.ReactNode, rightSlot?: React.ReactNode) => (
    <ModalScreen onClose={close} closeIcon='x' title={languageName} rightSlot={rightSlot}>
      {children}
    </ModalScreen>
  )

  if (isLoading) {
    return wrap(<FlashcardSkeleton />)
  }

  // Done: live queue exhausted (also the empty-batch / nothing-due case).
  if (!queue[index] && !isPeeking) {
    const sessionHard = [...sessionHardRef.current]
    const hardCount = sessionHard.length
    // Scope-aware empty copy: a scoped queue being empty doesn't mean nothing
    // is due — learn_new with no unseen terms must not claim "nothing due".
    const emptyQueueLabel =
      scope === 'learn_new'
        ? t`No new terms to learn.`
        : scope === 'review_due'
          ? t`No reviews are due right now.`
          : t`No terms are due right now.`
    const openStrengthen = () =>
      void navigate({
        to: '/practice/strengthen/$targetLanguage',
        params: { targetLanguage },
        search: { pool, sessionHard },
      })
    return wrap(
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
          <CircleCheck className='h-10 w-10 text-emerald-600' />
          <p className='text-lg font-semibold'>{queue.length === 0 ? emptyQueueLabel : t`All done!`}</p>
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

  if (!current) return wrap(<FlashcardSkeleton />)

  const card = current.card
  const nativeLanguage = userPrefs?.nativeLanguage ?? null
  const sameLanguage = !!nativeLanguage && nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  const hideTranslationFields = sameLanguage || !getShowTranslationsEnabledForLanguage(userPrefs, targetLanguage)
  const englishIpaDialect = userPrefs?.englishIpaDialect ?? 'ga'

  // Pronunciation facet (recognition queue): front prompts the target + an
  // audio cue ("say it out loud"), the flip reveals the stressed display form
  // + IPA. Distinct enough from the meaning layouts (no slot resolver, its own
  // audio chip) that it gets a dedicated body. Form-aware: a form card reads
  // its own facetPayload (display + IPA — deliberately no lemma fallback, a
  // lemma's transcription is wrong for an inflection); citation reads the
  // lemma row. The IPA falls back across dialects so a card that passed the
  // readiness gate never reveals an empty back (the citation IPA-vanished case
  // is handled server-side by deleting the facet — see
  // reconcilePronunciationFacet; a form facet without IPA never reaches ready).
  const isPronunciation = card.skill === 'pronunciation'
  const isFormCard = card.targetForm !== ''
  const facetPayload = (card.facetPayload ?? {}) as Record<string, unknown>
  const formGrammar: Grammar =
    facetPayload.grammar && typeof facetPayload.grammar === 'object' && !Array.isArray(facetPayload.grammar)
      ? (facetPayload.grammar as Grammar)
      : {}
  const pronunciationDisplay =
    isFormCard && typeof facetPayload.form === 'string'
      ? formGrammar.display_form || facetPayload.form
      : card.grammar?.display_form || card.headword
  const pronunciationIpa = isPronunciation
    ? isFormCard
      ? pickIpaForDisplay(formGrammar.ipa, targetLanguage, englishIpaDialect)
      : pickIpaForDisplay(card.grammar?.ipa, targetLanguage, englishIpaDialect)
    : undefined
  // Blue check next to the IPA when the transcription is dictionary-grounded
  // (citation cards only — ipaSource is computed server-side and always null
  // for forms, whose IPA is generated).
  const ipaBadge =
    card.ipaSource === 'wiktionary' ? (
      <span title={t`Verified by Wiktionary`} aria-label={t`Verified by Wiktionary`}>
        <BadgeCheck className='h-3.5 w-3.5 text-sky-600' />
      </span>
    ) : null

  // A queued card whose target_form is a specific inflection now carries its OWN
  // full card content in facetPayload (translation / definition / examples /
  // grammar). resolveCardContent prefers that per field and falls back to the
  // lemma where the form is silent — except IPA, which never falls back (a
  // lemma's transcription is wrong for an inflection). The form swaps into the
  // 'headword' slot (front on recognition, back on production) and the lemma is
  // demoted to a secondary line on the back. Citation cards resolve to the lemma.
  const content = resolveCardContent(card, targetLanguage, englishIpaDialect)

  const cond: CardSlotConditions = {
    hideTranslationFields,
    hasIpa: !!content.ipa,
    hasTargetExample: !!content.targetExample,
    hasNativeExample: !!content.nativeExample,
    hasTranslation: !!content.translation,
    hasDefinition: !!content.definition,
    hasGrammarChips: !!content.grammar,
  }

  // Production fronts are gloss-only; a card with no translation, no
  // definition and no example translation would render a blank front — fall
  // back to the recognition layout for that card.
  const poolConfig = getCardFaceConfig(targetLanguage, pool)
  const poolFront = resolveCardSlots(poolConfig.front, cond)
  const faceConfig = poolFront.length > 0 ? poolConfig : getCardFaceConfig(targetLanguage, 'recognition')
  const frontSlots = poolFront.length > 0 ? poolFront : resolveCardSlots(faceConfig.front, cond)
  const backSlots = resolveCardSlots(faceConfig.back, cond)
  // Peeked cards are always shown fully (front + back), read-only.
  const showBack = revealed || isPeeking

  // Peek re-rate: offered when the displayed (peeked) item has a durably
  // applied rating AND its redrill copy wasn't itself rated yet — once the
  // copy is rated, the original's event is no longer the latest live one (the
  // server would refuse the undo too; don't offer dead buttons).
  const peekRecord = isPeeking ? ratingRecordsRef.current.get(current) : undefined
  const canRerate = !!peekRecord && (!peekRecord.redrill || !ratingRecordsRef.current.has(peekRecord.redrill))

  const renderSlot = (slot: CardSlotKey, face: 'front' | 'back') => {
    switch (slot) {
      case 'headword': {
        const fullForm = content.displayForm
        return (
          <div key='headword' className='flex flex-col items-center gap-1'>
            <span lang={targetLanguage} className='text-2xl font-bold'>
              {faceConfig.hideStressOnFront && !showBack ? stripStressMarks(fullForm) : fullForm}
            </span>
            {content.citationForms && (
              <span lang={targetLanguage} className='text-muted-foreground text-base'>
                {content.citationForms}
              </span>
            )}
          </div>
        )
      }
      case 'ipa':
        return content.ipa ? (
          <div key='ipa' className='text-muted-foreground flex items-center justify-center gap-1.5 text-base'>
            <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />
            <span>{content.ipa}</span>
            {ipaBadge}
          </div>
        ) : null
      case 'targetExample':
        return content.targetExample ? (
          <p key='targetExample' className='border-l-2 border-yellow-300 pl-3 text-left text-base'>
            {content.targetExample}
          </p>
        ) : null
      case 'nativeExample':
        return content.nativeExample ? (
          <p key='nativeExample' className='text-muted-foreground pl-3 text-left text-base'>
            {content.nativeExample}
          </p>
        ) : null
      case 'translation': {
        return content.translation ? (
          <p key='translation' className='text-lg'>
            {content.translation}
          </p>
        ) : null
      }
      case 'definition':
        // On an active front the definition is the prompt itself (translation
        // fallback), so it gets prompt sizing instead of footnote sizing.
        return content.definition ? (
          <p key='definition' className={face === 'front' ? 'text-lg' : 'text-muted-foreground text-sm'}>
            {content.definition}
          </p>
        ) : null
      case 'grammar':
        return (
          <div key='grammar' className='flex justify-center'>
            <GrammarChips grammar={content.grammar} targetLanguage={targetLanguage} />
          </div>
        )
      default:
        return null
    }
  }

  // Actions for the DISPLAYED card (current or peeked) — opened from the
  // header kebab, like the vocabulary rows.
  const actionsButton = (
    <Button type='button' variant='ghost' size='icon' aria-label={t`Card actions`} onClick={() => setActionsOpen(true)}>
      <MoreVertical className='h-5 w-5' />
    </Button>
  )

  return wrap(
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-8 text-center'>
          {isPronunciation ? (
            <>
              {/* Front: bare target (ru stress hidden so the answer isn't
                  given away) + an audio cue. Audio playback is roadmap; the chip
                  is the "pronounce this" prompt, not a player. */}
              <span lang={targetLanguage} className='text-2xl font-bold'>
                {stripStressMarks(pronunciationDisplay)}
              </span>
              <div className='text-muted-foreground flex items-center gap-1.5 text-sm'>
                <Volume2 className='h-4 w-4' />
                <span>{t`Say it out loud`}</span>
              </div>
              {showBack && (
                <>
                  <div className='my-2 w-full border-t' />
                  {/* Back: stressed display form + IPA. */}
                  <span lang={targetLanguage} className='text-2xl font-bold'>
                    {pronunciationDisplay}
                  </span>
                  {pronunciationIpa && (
                    <div className='text-muted-foreground flex items-center justify-center gap-1.5 text-base'>
                      <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />
                      <span>{pronunciationIpa}</span>
                      {ipaBadge}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {frontSlots.map((slot) => renderSlot(slot, 'front'))}
              {showBack && (
                <>
                  <div className='my-2 w-full border-t' />
                  {content.lemma && (
                    <p className='text-muted-foreground text-sm'>
                      <span lang={targetLanguage} className='font-medium'>
                        {content.lemma.displayForm}
                      </span>
                      {content.lemma.translation ? ` — ${content.lemma.translation}` : null}
                    </p>
                  )}
                  {backSlots.map((slot) => renderSlot(slot, 'back'))}
                </>
              )}
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
            <>
              {canRerate && peekRecord && (
                <div className='flex flex-col gap-1.5'>
                  <p className='text-muted-foreground text-center text-xs'>{t`Change your rating`}</p>
                  <RateButtons
                    value={peekRecord.rating}
                    disabled={pendingRerate != null}
                    onSelect={(value) => handleRerate(current, value)}
                  />
                </div>
              )}
              <Button type='button' size='xl' variant='outline' className='w-full' onClick={() => setPeekBack(0)}>
                {t`Back to current card`}
              </Button>
            </>
          ) : showBack ? (
            <RateButtons onSelect={handleRate} />
          ) : (
            <Button type='button' size='xl' className='w-full' onClick={() => setRevealed(true)}>
              {t`Show answer`}
            </Button>
          )}
        </div>
      </div>
      <FlashcardActionsOverlay
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        term={card}
        targetLanguage={targetLanguage}
        pool={pool}
      />
    </div>,
    actionsButton
  )
}
