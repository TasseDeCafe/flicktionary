import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Brain, ChevronLeft, CircleCheck, Clock, Layers, Plus, RotateCcw, Star, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  OverlayContent,
  OverlayDescription,
  OverlayFooter,
  OverlayHeader,
  OverlayTitle,
  ResponsiveOverlay,
} from '@/components/ui/responsive-overlay'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import type { PracticeDueSummaryEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { PracticeSessionMode } from '@flicktionary/api-client/orpc-contracts/practice-contract'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { useAbandonPracticeSession, useDueSummary } from '../api/practice-hooks'

type PracticeAction = {
  label: string
  mode: PracticeSessionMode
  icon: 'review' | 'new'
}

const formatCount = (count: number) => count.toLocaleString()

export const PracticeLanguageView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/language/$targetLanguage' })
  const { data: summary, isLoading } = useDueSummary()
  const { data: prefs } = useGetUserPrefs()
  const { mutate: abandonSession, isPending: isEnding } = useAbandonPracticeSession()
  const [confirmEndOpen, setConfirmEndOpen] = useState(false)
  const [confirmFlashcardsOpen, setConfirmFlashcardsOpen] = useState(false)

  const entry = summary?.find((row) => row.targetLanguage === targetLanguage) ?? null
  const languageName = getLanguageName(targetLanguage)
  const maxNewTerms = prefs?.practiceMaxNewTerms ?? 20
  const maxReviewTerms = prefs?.practiceMaxReviewTerms ?? 100

  const dailyNewAvailable = entry ? getDailyNewAvailable(entry, maxNewTerms) : 0
  const dueTermCount = entry ? entry.reviewDueCount + entry.learningDueCount : 0
  // Passive-pool ('normal SRS reviews') and active-pool ('drill') sessions are
  // independent; both can be active for the same language.
  const passiveSessionId = entry?.passivePracticeSessionId ?? null
  const activeDrillSessionId = entry?.activePracticeSessionId ?? null
  const activeTotal = entry?.activeTotal ?? 0
  const activeDueCount = entry ? entry.activeReviewDueCount + entry.activeLearningDueCount : 0
  const activeNewCount = entry?.activeNewCount ?? 0
  const hasActiveDrillWork = activeDueCount + activeNewCount > 0

  const formatFollowUpDelay = (nextLearningDueAt: string | null) => {
    if (!nextLearningDueAt) return null
    const minutesUntilFollowUp = Math.max(1, Math.ceil((new Date(nextLearningDueAt).getTime() - Date.now()) / 60_000))
    if (!Number.isFinite(minutesUntilFollowUp)) return null
    if (minutesUntilFollowUp < 60) return t`Follow-up in ${minutesUntilFollowUp} min`
    const hoursUntilFollowUp = Math.ceil(minutesUntilFollowUp / 60)
    if (hoursUntilFollowUp < 24) return t`Follow-up in ${hoursUntilFollowUp} hr`
    return t`Follow-up later`
  }

  const hasReviewWork = dueTermCount > 0 && maxReviewTerms > 0
  // Flashcards review the same due cards and introduce the same daily-capped new
  // cards as reading, so it's offered whenever either has work.
  const flashcardsEnabled = hasReviewWork || dailyNewAvailable > 0

  // Primary action is a single unified session: 'mixed' drills due follow-ups
  // first and then introduces the day's new terms in one sitting, so finishing
  // doesn't leave new terms waiting behind a second session.
  const primaryAction: PracticeAction | null = (() => {
    if (!entry) return null
    if (passiveSessionId) return { label: t`Continue session`, mode: 'review_due', icon: 'review' }
    if (hasReviewWork || dailyNewAvailable > 0) {
      return { label: t`Practice`, mode: 'mixed', icon: 'review' }
    }
    if (entry.newCount > 0 && maxNewTerms > 0) {
      return { label: t`Learn more anyway`, mode: 'learn_extra', icon: 'new' }
    }
    return null
  })()

  // Granular splits offered as advanced options alongside the unified session.
  const secondaryActions: PracticeAction[] = (() => {
    if (!entry || passiveSessionId) return []
    // When the primary is the unified 'mixed' session, expose the individual
    // halves for users who want to review or learn in isolation.
    if (hasReviewWork || dailyNewAvailable > 0) {
      const actions: PracticeAction[] = []
      if (hasReviewWork) actions.push({ label: t`Review only`, mode: 'review_due', icon: 'review' })
      if (dailyNewAvailable > 0) actions.push({ label: t`Learn new only`, mode: 'learn_new', icon: 'new' })
      // Only meaningful when 'mixed' actually combines both halves.
      return actions.length > 1 ? actions : []
    }
    return []
  })()

  const statusLine = (() => {
    if (!entry) return ''
    const followUpDelay = formatFollowUpDelay(entry.nextLearningDueAt)
    const totalKept = entry.totalKept
    const newCount = entry.newCount

    if (passiveSessionId) {
      const parts = [followUpDelay, newCount > 0 ? t`${newCount} unseen` : null, t`${totalKept} total`].filter(
        (part): part is string => part != null
      )
      return parts.join(' · ')
    }
    if (dueTermCount > 0 && maxReviewTerms > 0) {
      const parts = [
        t`${dueTermCount} follow-up(s) ready`,
        dailyNewAvailable > 0 ? t`${dailyNewAvailable} new available today` : null,
        newCount > dailyNewAvailable ? t`${newCount} unseen` : null,
      ].filter((part): part is string => part != null)
      return parts.join(' · ')
    }
    if (dailyNewAvailable > 0) return t`${dailyNewAvailable} new term(s) available today.`
    if (newCount > 0 && maxNewTerms > 0) return t`Daily new limit reached. You can learn more anyway.`
    if (followUpDelay) return t`Come back later. ${followUpDelay}.`
    return t`No practice terms are ready right now.`
  })()

  const handleBack = () => {
    void navigate({ to: '/practice' })
  }

  const handleStart = (mode: PracticeSessionMode) => {
    void navigate({
      to: '/practice/start',
      search: { lang: targetLanguage, mode },
    })
  }

  const goToFlashcards = () => {
    void navigate({ to: '/practice/flashcards/$targetLanguage', params: { targetLanguage } })
  }

  // The reading flow snapshots eligible chunks at session start and ignores the
  // live SRS clock for that sitting, so a card rated via flashcards would be
  // re-rated (FSRS applied twice) when the reading session finalizes. Since the
  // user picks one passive-review mode per sitting, make the two mutually
  // exclusive: if a reading session is active, confirm + abandon it first.
  const handleFlashcards = () => {
    if (passiveSessionId) {
      setConfirmFlashcardsOpen(true)
      return
    }
    goToFlashcards()
  }

  const handleConfirmFlashcards = () => {
    if (!passiveSessionId) {
      goToFlashcards()
      return
    }
    abandonSession(
      { sessionId: passiveSessionId },
      {
        onSuccess: () => {
          setConfirmFlashcardsOpen(false)
          goToFlashcards()
        },
      }
    )
  }

  // The "End session" controls only target the passive-pool session — the
  // active drill has its own End button in its section.
  const handleEndSession = () => {
    if (!passiveSessionId) return
    abandonSession(
      { sessionId: passiveSessionId },
      {
        onSuccess: () => {
          setConfirmEndOpen(false)
        },
      }
    )
  }

  const handleEndActiveDrill = () => {
    if (!activeDrillSessionId) return
    abandonSession({ sessionId: activeDrillSessionId })
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6'>
          <header className='flex items-center gap-3'>
            <Button type='button' variant='ghost' size='icon' onClick={handleBack} aria-label={t`Back to Practice`}>
              <ChevronLeft className='h-5 w-5' />
            </Button>
            <h1 className='min-w-0 flex-1 truncate text-2xl font-bold'>{languageName}</h1>
          </header>

          {isLoading && <div className='py-8 text-center text-sm text-gray-500'>{t`Loading…`}</div>}

          {!isLoading && !entry && (
            <div className='rounded-xl border bg-yellow-50 p-6'>
              <h2 className='font-semibold'>{t`No vocabulary to practice yet`}</h2>
              <p className='mt-2 text-sm text-gray-700'>
                {t`Process a session and keep some cards. They'll show up here automatically.`}
              </p>
            </div>
          )}

          {entry && (
            <>
              <section className='rounded-xl border bg-white p-4'>
                <h2 className='text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase'>{t`Passive vocabulary`}</h2>
                <div className='flex items-start gap-3'>
                  {passiveSessionId ? (
                    <Clock className='mt-1 h-5 w-5 text-yellow-600' />
                  ) : primaryAction ? (
                    <Brain className='mt-1 h-5 w-5 text-yellow-600' />
                  ) : (
                    <CircleCheck className='mt-1 h-5 w-5 text-emerald-600' />
                  )}
                  <div className='min-w-0 flex-1'>
                    <h3 className='font-semibold'>
                      {passiveSessionId
                        ? t`Session in progress`
                        : primaryAction
                          ? t`Ready to practice`
                          : t`All caught up`}
                    </h3>
                    {statusLine && <p className='text-muted-foreground mt-1 text-sm'>{statusLine}</p>}
                  </div>
                </div>
                <div className='mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap'>
                  <Button
                    type='button'
                    size='lg'
                    disabled={!primaryAction || isEnding}
                    onClick={() => {
                      if (!primaryAction) return
                      handleStart(primaryAction.mode)
                    }}
                  >
                    {primaryAction?.icon === 'review' ? (
                      <RotateCcw className='h-4 w-4' />
                    ) : (
                      <Plus className='h-4 w-4' />
                    )}
                    {primaryAction?.label ?? t`All caught up`}
                  </Button>
                  {!passiveSessionId &&
                    secondaryActions.map((action) => (
                      <Button
                        key={action.mode}
                        type='button'
                        variant='outline'
                        size='lg'
                        disabled={isEnding}
                        onClick={() => handleStart(action.mode)}
                      >
                        {action.icon === 'review' ? <RotateCcw className='h-4 w-4' /> : <Plus className='h-4 w-4' />}
                        {action.label}
                      </Button>
                    ))}
                  {passiveSessionId && (
                    <Button
                      type='button'
                      variant='outline'
                      size='lg'
                      disabled={isEnding}
                      onClick={() => setConfirmEndOpen(true)}
                    >
                      <XCircle className='h-4 w-4' />
                      {t`End session`}
                    </Button>
                  )}
                  <Button
                    type='button'
                    variant='outline'
                    size='lg'
                    disabled={!flashcardsEnabled || isEnding}
                    onClick={handleFlashcards}
                  >
                    <Layers className='h-4 w-4' />
                    {t`Flashcards`}
                  </Button>
                </div>
              </section>

              <section className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                <PracticeMetric label={t`Follow-ups`} value={formatCount(dueTermCount)} />
                <PracticeMetric label={t`New today`} value={formatCount(dailyNewAvailable)} />
                <PracticeMetric label={t`Unseen`} value={formatCount(entry.newCount)} />
                <PracticeMetric label={t`Total`} value={formatCount(entry.totalKept)} />
              </section>

              {activeTotal > 0 && (
                <section className='rounded-xl border bg-amber-50/40 p-4'>
                  <h2 className='text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase'>
                    <Star className='h-3.5 w-3.5 text-amber-600' />
                    {t`Active vocabulary`}
                  </h2>
                  <p className='text-sm text-gray-700'>
                    {activeDrillSessionId
                      ? t`Active drill in progress`
                      : hasActiveDrillWork
                        ? t`${activeDueCount} due, ${activeNewCount} new`
                        : t`${activeTotal} active term(s). Nothing due right now.`}
                  </p>
                  <div className='mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap'>
                    {activeDrillSessionId ? (
                      <>
                        <Button
                          type='button'
                          size='lg'
                          onClick={() =>
                            void navigate({
                              to: '/practice/$practiceSessionId',
                              params: { practiceSessionId: activeDrillSessionId },
                            })
                          }
                        >
                          <RotateCcw className='h-4 w-4' />
                          {t`Continue active drill`}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='lg'
                          disabled={isEnding}
                          onClick={handleEndActiveDrill}
                        >
                          <XCircle className='h-4 w-4' />
                          {t`End active drill`}
                        </Button>
                      </>
                    ) : (
                      <Button
                        type='button'
                        size='lg'
                        disabled={!hasActiveDrillWork || isEnding}
                        onClick={() => handleStart('active_drill')}
                      >
                        <Star className='h-4 w-4' />
                        {t`Drill active terms`}
                      </Button>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <ResponsiveOverlay open={confirmEndOpen} onOpenChange={setConfirmEndOpen}>
        <OverlayContent>
          <OverlayHeader>
            <OverlayTitle>{t`End practice session?`}</OverlayTitle>
            <OverlayDescription>
              {t`Already-rated terms will keep their ratings. Unrated terms stay available for later sessions.`}
            </OverlayDescription>
          </OverlayHeader>
          <OverlayFooter>
            <Button
              type='button'
              variant='outline'
              size='xl'
              onClick={() => setConfirmEndOpen(false)}
              disabled={isEnding}
            >
              {t`Cancel`}
            </Button>
            <Button type='button' size='xl' variant='destructive' onClick={handleEndSession} disabled={isEnding}>
              {isEnding ? t`Ending…` : t`End session`}
            </Button>
          </OverlayFooter>
        </OverlayContent>
      </ResponsiveOverlay>

      <ResponsiveOverlay open={confirmFlashcardsOpen} onOpenChange={setConfirmFlashcardsOpen}>
        <OverlayContent>
          <OverlayHeader>
            <OverlayTitle>{t`End reading session?`}</OverlayTitle>
            <OverlayDescription>
              {t`You have a reading session in progress. End it to start flashcards.`}
            </OverlayDescription>
          </OverlayHeader>
          <OverlayFooter>
            <Button
              type='button'
              variant='outline'
              size='xl'
              onClick={() => setConfirmFlashcardsOpen(false)}
              disabled={isEnding}
            >
              {t`Cancel`}
            </Button>
            <Button type='button' size='xl' onClick={handleConfirmFlashcards} disabled={isEnding}>
              {isEnding ? t`Ending…` : t`End & start flashcards`}
            </Button>
          </OverlayFooter>
        </OverlayContent>
      </ResponsiveOverlay>
    </div>
  )
}

const PracticeMetric = ({ label, value }: { label: string; value: string }) => (
  <div className='rounded-xl border bg-white p-4'>
    <div className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>{label}</div>
    <div className='mt-2 text-2xl font-semibold tabular-nums'>{value}</div>
  </div>
)

const getDailyNewAvailable = (entry: PracticeDueSummaryEntry, maxNewTerms: number) => {
  if (maxNewTerms <= 0) return 0
  const remainingDailyNewTerms = Math.max(0, maxNewTerms - entry.newIntroducedTodayCount)
  return Math.min(entry.newCount, remainingDailyNewTerms)
}
