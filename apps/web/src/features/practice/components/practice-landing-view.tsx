import { useMemo } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { PageContainer } from '@/components/page-container'
import { Brain, ChevronRight, X } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton, SkeletonList } from '@flicktionary/ui/components/skeleton'
import { usePreviewPracticeQueues, useDueSummary, type PracticeQueuePreview } from '../api/practice-hooks'
import { useAddAccountFlag, useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import type { PracticeDueSummaryEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { plannedTotal } from '../utils/daily-mix'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'

// One-time "How practice works" explainer; dismissing it records the
// practice_explainer_dismissed account flag so it never returns on any device.
const HowPracticeWorksCard = ({ onDismiss }: { onDismiss: () => void }) => {
  const { t } = useLingui()
  const points = [
    t`Terms you save become cards scheduled with spaced repetition — each review comes up right before you'd forget it.`,
    t`A session mixes the reviews due today with a few new terms. Daily limits keep it short; you can change them in Settings.`,
    t`Brand-new and struggling terms warm up with quick exercises before they become flashcards.`,
    t`You can also practice by reading: short generated texts weave in your vocabulary, and you rate terms by tapping them.`,
  ]
  return (
    <section className='bg-card rounded-xl border p-4'>
      <div className='flex items-start justify-between gap-2'>
        <h2 className='text-sm font-semibold'>{t`How practice works`}</h2>
        <button
          type='button'
          aria-label={t`Dismiss the practice explainer`}
          onClick={onDismiss}
          className='text-muted-foreground hover:text-foreground active:text-foreground -mt-1 -mr-1 rounded-md p-1 transition-colors'
        >
          <X className='h-4 w-4' />
        </button>
      </div>
      <ol className='text-muted-foreground mt-2 list-decimal space-y-1.5 pl-5 text-sm'>
        {points.map((point, index) => (
          <li key={index}>{point}</li>
        ))}
      </ol>
      <div className='mt-3 flex items-center gap-4'>
        <Button size='sm' variant='secondary' onClick={onDismiss}>
          {t`Got it`}
        </Button>
        <Link to='/user-guide' hash='practice' className='text-sm font-medium underline'>
          {t`Read more in the guide`}
        </Link>
      </div>
    </section>
  )
}

export const PracticeLandingView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: summary, isLoading: isSummaryLoading } = useDueSummary()
  const { data: prefs } = useGetUserPrefs()
  const addFlag = useAddAccountFlag()

  const languages = useMemo(() => (summary ?? []).map((entry) => entry.targetLanguage), [summary])
  const previews = usePreviewPracticeQueues(languages)
  const isLoading = isSummaryLoading || previews.some((query) => query.isLoading)

  // Render neither the explainer nor the intro line until prefs resolve —
  // returning users must not see the one-time card flash.
  const explainerResolved = prefs !== undefined
  const showExplainer =
    explainerResolved &&
    !prefs.accountFlags.includes('practice_explainer_dismissed') &&
    !addFlag.isPending &&
    !addFlag.isSuccess

  const handlePickLanguage = (targetLanguage: string) => {
    void navigate({
      to: '/practice/language/$targetLanguage',
      params: { targetLanguage },
    })
  }

  // The leading part is the session-plan preview's planned total — the same
  // query the Daily Mix banner and language landing use, so a row never
  // promises cards the next compose won't serve (raw due-summary counts
  // overpromise: e.g. warmupCount is the whole ladder backlog, not the few
  // gates a session serves). The trailing parts stay deck descriptors.
  const getSummaryLine = (entry: PracticeDueSummaryEntry, preview: PracticeQueuePreview | undefined) => {
    const total = preview ? plannedTotal(preview.counts) : 0
    const introductionBudgetSpent = preview?.dailyBudget.remaining === 0 && preview.dailyLimitReached
    const sessionPart =
      total > 0
        ? plural(total, { one: '# card ready', other: '# cards ready' })
        : introductionBudgetSpent
          ? t`Daily new limit reached`
          : t`All caught up`
    const parts = [sessionPart]
    if (entry.productionTotal > 0) {
      const productionCount = entry.productionTotal
      parts.push(t`${productionCount} in production`)
    }
    const parkedTotal = entry.parkedCount + entry.productionParkedCount
    if (parkedTotal > 0) {
      parts.push(t`${parkedTotal} parked`)
    }
    return parts.join(' • ')
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto'>
        <PageContainer width='narrow' className='flex flex-col gap-6'>
          <header className='flex items-center gap-3'>
            <Brain className='h-7 w-7 text-yellow-500' />
            <h1 className='text-2xl font-bold'>{t`Practice`}</h1>
          </header>

          {/* The one-time explainer supersedes the static intro line; the
              intro returns once the explainer is dismissed so the page never
              shows both. */}
          {showExplainer ? (
            <HowPracticeWorksCard
              onDismiss={() => {
                POSTHOG_EVENTS.practiceExplainerDismissed()
                addFlag.mutate({ flag: 'practice_explainer_dismissed' })
              }}
            />
          ) : (
            explainerResolved && (
              <p className='text-muted-foreground text-sm'>
                {t`Read short generated texts that weave in your kept vocabulary. Tap a term to rate it; terms you don't tap are scored as recognized when you advance.`}
              </p>
            )
          )}

          {isLoading && (
            <section className='flex flex-col gap-2'>
              <h2 className='text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase'>{t`Languages`}</h2>
              <div className='divide-border bg-card divide-y overflow-hidden rounded-xl border'>
                <SkeletonList
                  count={5}
                  renderItem={() => (
                    <div className='flex items-center gap-3 px-4 py-4'>
                      <div className='flex min-w-0 flex-1 flex-col gap-2'>
                        <Skeleton className='h-4 w-24' />
                        <Skeleton className='h-3 w-40' />
                      </div>
                      <Skeleton className='h-5 w-5 shrink-0 rounded-full' />
                    </div>
                  )}
                />
              </div>
            </section>
          )}

          {!isLoading && (!summary || summary.length === 0) && (
            <div className='rounded-xl border bg-yellow-50 p-6 dark:bg-yellow-400/10'>
              <h2 className='font-semibold'>{t`No vocabulary to practice yet`}</h2>
              <p className='text-muted-foreground mt-2 text-sm'>
                {t`Save a term while watching or reading in a session. Flicktionary enriches it in the background and adds it to your Vocabulary and Practice automatically.`}
              </p>
              <div className='mt-3 flex flex-wrap gap-4 text-sm'>
                <Link to='/sessions' className='font-medium text-yellow-900 underline dark:text-yellow-300'>
                  {t`Go to your sessions`}
                </Link>
                <Link to='/user-guide' hash='practice' className='font-medium underline'>
                  {t`Read more in the guide`}
                </Link>
              </div>
            </div>
          )}

          {!isLoading && summary && summary.length > 0 && (
            <section className='flex flex-col gap-2'>
              <h2 className='text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase'>{t`Languages`}</h2>
              <div className='divide-border bg-card divide-y overflow-hidden rounded-xl border'>
                {summary.map((entry, index) => {
                  const preview = previews[index]
                  // A failed preview must not read as "All caught up" — the
                  // row still opens the language landing, which has retry.
                  const summaryLine = preview?.isError
                    ? t`Couldn't load your session preview`
                    : getSummaryLine(entry, preview?.data)
                  return (
                    <button
                      key={entry.targetLanguage}
                      type='button'
                      onClick={() => handlePickLanguage(entry.targetLanguage)}
                      className='hover:bg-accent active:bg-accent flex w-full items-center gap-3 px-4 py-4 text-left transition-colors'
                    >
                      <div className='flex min-w-0 flex-1 flex-col'>
                        <span className='text-sm font-medium'>{getLanguageName(entry.targetLanguage)}</span>
                        <span className='text-muted-foreground text-xs'>{summaryLine}</span>
                      </div>
                      <ChevronRight className='text-muted-foreground h-5 w-5 shrink-0' />
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </PageContainer>
      </div>
    </div>
  )
}
