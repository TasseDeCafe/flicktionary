import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, CircleCheck, Dumbbell, Pencil } from 'lucide-react'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { RateButtons, type RateValue } from '@flicktionary/ui/components/rate-buttons'
import { type FloatingSheetAnchor } from '@flicktionary/ui/components/floating-sheet'
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
  Chunk,
  PracticePool,
  ReviewScope,
  ReviewTerm,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { StressMarkedText } from './stress-marked-text'
import { PracticeLoader } from './practice-loader'
import { ReviewQueueStats } from './review-queue-stats'
import { EditCardSheet } from './edit-card-sheet'
import type { QueueCounts } from './review-counts'
import { useListReviewTerms, useRateTerm, useUndoRating } from '../api/practice-hooks'

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
  // Mid-session edit sheet (anchor = the pencil button that opened it).
  const [editSheet, setEditSheet] = useState<{ anchor: FloatingSheetAnchor } | null>(null)
  // Live content edits overlaid on the displayed card at render time, keyed by
  // userLookupId. Rewriting QueueItems would break every object-identity
  // pointer (redrill rollback, rating records); the overlay preserves them and
  // covers redrill copies of the same lookup for free. Counters are unaffected
  // — they classify by srsState, which editing never touches.
  const [chunkOverrides, setChunkOverrides] = useState<Map<string, Partial<ReviewTerm>>>(new Map())

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
      // learnNewSession lets introductions in an explicit learn-new session
      // bypass the daily-new cap (they still count toward today's intros).
      // Gated on `count` to mirror the fetch-time bypass (requestedNewCount):
      // only the batch-sheet flow supplies it, so a direct/bookmarked
      // learn_new URL without a chosen batch stays within the daily budget at
      // rating time too.
      { userLookupId: card.userLookupId, rating, pool, learnNewSession: scope === 'learn_new' && count != null },
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
      { userLookupId: card.userLookupId, pool, eventId: record.eventId },
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

  // Live queue sync from the edit sheet: overlay the freshest chunk content
  // onto every queue item showing this lookup (originals + redrill copies).
  const syncChunk = (chunk: Chunk) => {
    setChunkOverrides((prev) => {
      const next = new Map(prev)
      next.set(chunk.id, {
        headword: chunk.headword,
        sense: chunk.sense,
        translation: chunk.translation,
        definition: chunk.definition,
        targetExample: chunk.targetExample,
        nativeExample: chunk.nativeExample,
        grammar: chunk.grammar,
      })
      return next
    })
  }

  if (isLoading) {
    return <PracticeLoader label={t`Loading review terms…`} />
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
    return (
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

  if (!current) return <PracticeLoader label={t`Loading…`} />

  // Edit-sheet overlay: merge live content edits into the displayed card.
  // Queue/record/redrill identities never change — only this render-time view.
  const override = chunkOverrides.get(current.card.userLookupId)
  const card = override ? { ...current.card, ...override } : current.card
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

  // Peek re-rate: offered when the displayed (peeked) item has a durably
  // applied rating AND its redrill copy wasn't itself rated yet — once the
  // copy is rated, the original's event is no longer the latest live one (the
  // server would refuse the undo too; don't offer dead buttons).
  const peekRecord = isPeeking ? ratingRecordsRef.current.get(current) : undefined
  const canRerate = !!peekRecord && (!peekRecord.redrill || !ratingRecordsRef.current.has(peekRecord.redrill))

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
            <div className='flex items-center gap-1'>
              {/* Edits the DISPLAYED card (front, back, or peeked). */}
              <Button
                type='button'
                variant='ghost'
                size='icon'
                aria-label={t`Edit card`}
                onClick={(event) => setEditSheet({ anchor: event.currentTarget.getBoundingClientRect() })}
              >
                <Pencil className='h-4 w-4' />
              </Button>
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
      <EditCardSheet
        open={editSheet != null}
        onOpenChange={(open) => !open && setEditSheet(null)}
        anchor={editSheet?.anchor ?? null}
        userLookupId={card.userLookupId}
        targetLanguage={targetLanguage}
        onChunkChange={syncChunk}
      />
    </div>
  )
}
