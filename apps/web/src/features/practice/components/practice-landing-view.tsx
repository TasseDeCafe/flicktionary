import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Brain, ChevronRight } from 'lucide-react'
import { useDueSummary } from '../api/practice-hooks'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import type { PracticeDueSummaryEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'

export const PracticeLandingView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: summary, isLoading } = useDueSummary()
  const { data: prefs } = useGetUserPrefs()

  const maxNewTerms = prefs?.practiceMaxNewTerms ?? 20
  const maxReviewTerms = prefs?.practiceMaxReviewTerms ?? 100

  const handlePickLanguage = (targetLanguage: string) => {
    void navigate({
      to: '/practice/language/$targetLanguage',
      params: { targetLanguage },
    })
  }

  const formatFollowUpDelay = (nextLearningDueAt: string | null) => {
    if (!nextLearningDueAt) return null
    const minutesUntilFollowUp = Math.max(1, Math.ceil((new Date(nextLearningDueAt).getTime() - Date.now()) / 60_000))
    if (!Number.isFinite(minutesUntilFollowUp)) return null
    if (minutesUntilFollowUp < 60) return t`Follow-up in ${minutesUntilFollowUp} min`
    const hoursUntilFollowUp = Math.ceil(minutesUntilFollowUp / 60)
    if (hoursUntilFollowUp < 24) return t`Follow-up in ${hoursUntilFollowUp} hr`
    return t`Follow-up later`
  }

  const getDailyNewAvailable = (entry: PracticeDueSummaryEntry) => {
    if (maxNewTerms <= 0) return 0
    const remainingDailyNewTerms = Math.max(0, maxNewTerms - entry.newIntroducedTodayCount)
    return Math.min(entry.newCount, remainingDailyNewTerms)
  }

  const getSummaryLine = (entry: PracticeDueSummaryEntry) => {
    const totalKept = entry.totalKept
    const dueTermCount = entry.reviewDueCount + entry.learningDueCount
    const newCount = entry.newCount
    const dailyNewAvailable = getDailyNewAvailable(entry)
    const hasDailyWork = (dueTermCount > 0 && maxReviewTerms > 0) || dailyNewAvailable > 0
    const followUpDelay = formatFollowUpDelay(entry.nextLearningDueAt)

    if (entry.activePracticeSessionId) {
      const parts = [
        t`Session in progress`,
        followUpDelay,
        newCount > 0 ? t`${newCount} unseen` : null,
        t`${totalKept} total`,
      ].filter((part): part is string => part != null)
      return parts.join(' · ')
    }
    if (!hasDailyWork && newCount > 0 && maxNewTerms > 0) {
      return t`Daily new limit reached · ${newCount} unseen · ${totalKept} total`
    }
    if (!hasDailyWork && followUpDelay) {
      return t`All caught up for today · ${followUpDelay} · ${totalKept} total`
    }
    if (!hasDailyWork) {
      return t`All caught up for today · ${totalKept} total`
    }

    const parts = [
      dueTermCount > 0 ? t`${dueTermCount} follow-up(s)` : null,
      dailyNewAvailable > 0 ? t`${dailyNewAvailable} new today` : null,
      newCount > dailyNewAvailable ? t`${newCount} unseen` : null,
      t`${totalKept} total`,
    ].filter((part): part is string => part != null)
    return parts.join(' · ')
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6'>
          <header className='flex items-center gap-3'>
            <Brain className='h-7 w-7 text-yellow-500' />
            <h1 className='text-2xl font-bold'>{t`Practice`}</h1>
          </header>

          <p className='text-sm text-gray-600'>
            {t`Read short generated texts that weave in your kept vocabulary. Tap a term to rate it; terms you don't tap are scored as recognized when you advance.`}
          </p>

          {isLoading && <div className='py-8 text-center text-sm text-gray-500'>{t`Loading…`}</div>}

          {!isLoading && (!summary || summary.length === 0) && (
            <div className='rounded-xl border bg-yellow-50 p-6'>
              <h2 className='font-semibold'>{t`No vocabulary to practice yet`}</h2>
              <p className='mt-2 text-sm text-gray-700'>
                {t`Process a session and keep some cards. They'll show up here automatically.`}
              </p>
            </div>
          )}

          {!isLoading && summary && summary.length > 0 && (
            <section className='flex flex-col gap-2'>
              <h2 className='text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase'>{t`Languages`}</h2>
              <div className='divide-y divide-gray-100 overflow-hidden rounded-xl border bg-white'>
                {summary.map((entry) => {
                  const summaryLine = getSummaryLine(entry)
                  return (
                    <button
                      key={entry.targetLanguage}
                      type='button'
                      onClick={() => handlePickLanguage(entry.targetLanguage)}
                      className='flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-gray-50'
                    >
                      <div className='flex min-w-0 flex-1 flex-col'>
                        <span className='truncate text-sm font-medium'>{getLanguageName(entry.targetLanguage)}</span>
                        <span className='text-muted-foreground truncate text-xs'>{summaryLine}</span>
                      </div>
                      <ChevronRight className='h-5 w-5 shrink-0 text-gray-400' />
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
