import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Brain, ChevronLeft, CircleCheck, Clock, Plus, RotateCcw, XCircle } from 'lucide-react'
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

  const entry = summary?.find((row) => row.targetLanguage === targetLanguage) ?? null
  const languageName = getLanguageName(targetLanguage)
  const maxNewTerms = prefs?.practiceMaxNewTerms ?? 20
  const maxReviewTerms = prefs?.practiceMaxReviewTerms ?? 100

  const dailyNewAvailable = entry ? getDailyNewAvailable(entry, maxNewTerms) : 0
  const dueTermCount = entry ? entry.reviewDueCount + entry.learningDueCount : 0
  const activeSessionId = entry?.activePracticeSessionId ?? null

  const formatFollowUpDelay = (nextLearningDueAt: string | null) => {
    if (!nextLearningDueAt) return null
    const minutesUntilFollowUp = Math.max(1, Math.ceil((new Date(nextLearningDueAt).getTime() - Date.now()) / 60_000))
    if (!Number.isFinite(minutesUntilFollowUp)) return null
    if (minutesUntilFollowUp < 60) return t`Follow-up in ${minutesUntilFollowUp} min`
    const hoursUntilFollowUp = Math.ceil(minutesUntilFollowUp / 60)
    if (hoursUntilFollowUp < 24) return t`Follow-up in ${hoursUntilFollowUp} hr`
    return t`Follow-up later`
  }

  const primaryAction: PracticeAction | null = (() => {
    if (!entry) return null
    if (entry.activePracticeSessionId) return { label: t`Continue session`, mode: 'review_due', icon: 'review' }
    if (dueTermCount > 0 && maxReviewTerms > 0) {
      return { label: t`Review follow-ups`, mode: 'review_due', icon: 'review' }
    }
    if (dailyNewAvailable > 0) return { label: t`Learn new terms`, mode: 'learn_new', icon: 'new' }
    if (entry.newCount > 0 && maxNewTerms > 0) {
      return { label: t`Learn more anyway`, mode: 'learn_extra', icon: 'new' }
    }
    return null
  })()

  const secondaryAction: PracticeAction | null = (() => {
    if (!entry) return null
    if (entry.activePracticeSessionId) return null
    if (dueTermCount > 0 && dailyNewAvailable > 0) {
      return { label: t`Learn new terms`, mode: 'learn_new', icon: 'new' }
    }
    if (dueTermCount > 0 && entry.newCount > 0 && maxNewTerms > 0) {
      return { label: t`Learn more anyway`, mode: 'learn_extra', icon: 'new' }
    }
    return null
  })()

  const statusLine = (() => {
    if (!entry) return ''
    const followUpDelay = formatFollowUpDelay(entry.nextLearningDueAt)
    const totalKept = entry.totalKept
    const newCount = entry.newCount

    if (entry.activePracticeSessionId) {
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

  const handleEndSession = () => {
    if (!activeSessionId) return
    abandonSession(
      { sessionId: activeSessionId },
      {
        onSuccess: () => {
          setConfirmEndOpen(false)
        },
      }
    )
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6'>
          <header className='flex items-center gap-3'>
            <Button type='button' variant='ghost' size='icon' onClick={handleBack} aria-label={t`Back to Practice`}>
              <ChevronLeft className='h-5 w-5' />
            </Button>
            <Brain className='h-7 w-7 text-yellow-500' />
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
                <div className='flex items-start gap-3'>
                  {activeSessionId ? (
                    <Clock className='mt-1 h-5 w-5 text-yellow-600' />
                  ) : primaryAction ? (
                    <Brain className='mt-1 h-5 w-5 text-yellow-600' />
                  ) : (
                    <CircleCheck className='mt-1 h-5 w-5 text-emerald-600' />
                  )}
                  <div className='min-w-0 flex-1'>
                    <h2 className='font-semibold'>
                      {activeSessionId
                        ? t`Session in progress`
                        : primaryAction
                          ? t`Ready to practice`
                          : t`All caught up`}
                    </h2>
                    {statusLine && <p className='text-muted-foreground mt-1 text-sm'>{statusLine}</p>}
                  </div>
                </div>
              </section>

              <section className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                <PracticeMetric label={t`Follow-ups`} value={formatCount(dueTermCount)} />
                <PracticeMetric label={t`New today`} value={formatCount(dailyNewAvailable)} />
                <PracticeMetric label={t`Unseen`} value={formatCount(entry.newCount)} />
                <PracticeMetric label={t`Total`} value={formatCount(entry.totalKept)} />
              </section>
            </>
          )}
        </div>
      </div>

      {entry && (
        <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 p-3 backdrop-blur'>
          <div className='mx-auto flex w-full max-w-2xl flex-col gap-2 sm:flex-row-reverse sm:items-center'>
            <Button
              type='button'
              size='lg'
              className='w-full sm:w-auto'
              disabled={!primaryAction || isEnding}
              onClick={() => {
                if (!primaryAction) return
                handleStart(primaryAction.mode)
              }}
            >
              {primaryAction?.icon === 'review' ? <RotateCcw className='h-4 w-4' /> : <Plus className='h-4 w-4' />}
              {primaryAction?.label ?? t`All caught up`}
            </Button>

            {activeSessionId ? (
              <Button
                type='button'
                variant='outline'
                size='lg'
                className='w-full sm:w-auto'
                disabled={isEnding}
                onClick={() => setConfirmEndOpen(true)}
              >
                <XCircle className='h-4 w-4' />
                {t`End session`}
              </Button>
            ) : (
              secondaryAction && (
                <Button
                  type='button'
                  variant='outline'
                  size='lg'
                  className='w-full sm:w-auto'
                  disabled={isEnding}
                  onClick={() => handleStart(secondaryAction.mode)}
                >
                  {secondaryAction.icon === 'review' ? <RotateCcw className='h-4 w-4' /> : <Plus className='h-4 w-4' />}
                  {secondaryAction.label}
                </Button>
              )
            )}
          </div>
        </div>
      )}

      <ResponsiveOverlay open={confirmEndOpen} onOpenChange={setConfirmEndOpen}>
        <OverlayContent>
          <OverlayHeader>
            <OverlayTitle>{t`End practice session?`}</OverlayTitle>
            <OverlayDescription>
              {t`Already-rated terms will keep their ratings. Unrated terms stay available for later sessions.`}
            </OverlayDescription>
          </OverlayHeader>
          <OverlayFooter>
            <Button type='button' variant='outline' onClick={() => setConfirmEndOpen(false)} disabled={isEnding}>
              {t`Cancel`}
            </Button>
            <Button type='button' onClick={handleEndSession} disabled={isEnding}>
              {isEnding ? t`Ending…` : t`End session`}
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
