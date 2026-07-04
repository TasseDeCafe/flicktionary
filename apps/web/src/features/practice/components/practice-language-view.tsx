import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { BookOpen, Brain, ChevronLeft, CircleCheck, SlidersHorizontal } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton, SkeletonList } from '@flicktionary/ui/components/skeleton'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getPracticeLimitsForLanguage } from '@/features/sessions/utils/practice-limits-pref'
import type { PracticePool } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { useDueSummary } from '../api/practice-hooks'
import { CustomPracticeOverlay } from './custom-practice-overlay'
import { getDailyNewAvailable } from './review-counts'

const formatCount = (count: number) => count.toLocaleString()

// The per-language landing: ONE primary Practice button entering the composed
// queue (gate exercises + due flashcards, production-first — the system makes
// the strategic decision), a Custom practice overlay for every secondary mode,
// and a one-line status summary that absorbs the old per-pool cards and the
// standalone "warming up" / "parked" banners.
export const PracticeLanguageView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/language/$targetLanguage' })
  const { data: summary, isLoading } = useDueSummary()
  const { data: prefs } = useGetUserPrefs()
  const [customOpen, setCustomOpen] = useState(false)

  const entry = summary?.find((row) => row.targetLanguage === targetLanguage) ?? null
  const languageName = getLanguageName(targetLanguage)
  const { maxNewTerms, maxReviewTerms } = getPracticeLimitsForLanguage(prefs, targetLanguage)

  const dailyNewAvailable = entry ? getDailyNewAvailable(entry, maxNewTerms) : 0
  // The review-due count is capped by what's left of today's review budget —
  // due cards beyond the spent budget won't be served until tomorrow, so the
  // landing must not advertise them as ready work.
  const reviewBudgetLeft = Math.max(0, maxReviewTerms - (entry?.reviewedTodayCount ?? 0))
  const servableReviewDue = entry ? Math.min(entry.reviewDueCount, reviewBudgetLeft) : 0
  const recognitionDue = entry ? servableReviewDue + entry.learningDueCount : 0
  const productionTotal = entry?.productionTotal ?? 0
  const productionDue = entry ? entry.productionReviewDueCount + entry.productionLearningDueCount : 0

  // Both pools fold into one line — the composed queue serves them in one
  // session, so the landing reports one workload.
  const reviewsDue = recognitionDue + productionDue
  const newToday = dailyNewAvailable + (entry?.productionNewCount ?? 0)
  const warmingUp = (entry?.warmupCount ?? 0) + (entry?.productionWarmupCount ?? 0)
  const parked = (entry?.parkedCount ?? 0) + (entry?.productionParkedCount ?? 0)
  const hasWork = reviewsDue + newToday + warmingUp + parked > 0

  const handleBack = () => void navigate({ to: '/practice' })

  const openPractice = () =>
    void navigate({
      to: '/practice/composed/$targetLanguage',
      params: { targetLanguage },
      search: {
        pools: ['production', 'recognition'] as PracticePool[],
        scope: 'both' as const,
        render: 'both' as const,
        autoWarmup: true,
        includeOptInNew: false,
      },
    })

  // Precedence once nothing is servable: review-limit reached (due work exists
  // only beyond the spent budget) > new-limit reached > all caught up.
  // Learning follow-ups due always count as servable work (budget-exempt).
  const statusLine = (() => {
    if (!entry) return ''
    if (hasWork) {
      const parts = [
        reviewsDue > 0 ? plural(reviewsDue, { one: '# to review', other: '# to review' }) : null,
        newToday > 0 ? t`${newToday} new today` : null,
        warmingUp > 0 ? t`${warmingUp} warming up` : null,
        parked > 0 ? t`${parked} to strengthen` : null,
      ].filter((p): p is string => p != null)
      return parts.join(' · ')
    }
    if (entry.reviewDueCount > 0 && reviewBudgetLeft <= 0) return t`Daily review limit reached.`
    if (entry.newCount > 0 && maxNewTerms > 0) return t`Daily new limit reached.`
    return t`No terms are ready right now.`
  })()

  // An open reading-mode text is otherwise invisible from the landing (it's
  // only reachable by re-entering Read mode, and only under its own scope —
  // a different scope discards it), so surface it with a resume affordance.
  const renderReadingAffordance = (pool: PracticePool) => {
    const reading = entry?.currentReadings.find((r) => r.pool === pool)
    if (!reading) return null
    return (
      <button
        type='button'
        onClick={() =>
          void navigate({
            to: '/practice/review/$targetLanguage',
            params: { targetLanguage },
            search: { pool, scope: reading.scope ?? 'mixed' },
          })
        }
        className='mt-3 flex w-full items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-left text-sm text-sky-800 transition-colors hover:bg-sky-100 active:bg-sky-100'
      >
        <BookOpen className='h-4 w-4 shrink-0' />
        {t`Reading in progress (${plural(reading.termCount, { one: '# term', other: '# terms' })}) — continue`}
      </button>
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
            <h1 className='min-w-0 flex-1 truncate text-2xl font-bold'>{languageName}</h1>
          </header>

          {isLoading && (
            <>
              <section className='bg-card rounded-xl border p-4'>
                <div className='flex items-start gap-3'>
                  <Skeleton className='mt-1 h-5 w-5 shrink-0 rounded-full' />
                  <div className='min-w-0 flex-1'>
                    <Skeleton className='h-5 w-40' />
                    <Skeleton className='mt-2 h-3 w-52' />
                  </div>
                </div>
                <div className='mt-4 flex flex-col gap-2'>
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-10 w-full' />
                </div>
              </section>
              <section className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                <SkeletonList
                  count={4}
                  renderItem={() => (
                    <div className='bg-card rounded-xl border p-4'>
                      <Skeleton className='h-3 w-16' />
                      <Skeleton className='mt-3 h-7 w-10' />
                    </div>
                  )}
                />
              </section>
            </>
          )}

          {!isLoading && !entry && (
            <div className='rounded-xl border bg-yellow-50 p-6 dark:bg-yellow-400/10'>
              <h2 className='font-semibold'>{t`No vocabulary to practice yet`}</h2>
              <p className='text-muted-foreground mt-2 text-sm'>
                {t`Process a session and keep some cards. They'll show up here automatically.`}
              </p>
            </div>
          )}

          {entry && (
            <>
              <section className='bg-card rounded-xl border p-4'>
                <div className='flex items-start gap-3'>
                  {hasWork ? (
                    <Brain className='mt-1 h-5 w-5 text-yellow-600 dark:text-yellow-400' />
                  ) : (
                    <CircleCheck className='mt-1 h-5 w-5 text-emerald-600' />
                  )}
                  <div className='min-w-0 flex-1'>
                    <h3 className='font-semibold'>{hasWork ? t`Ready to practice` : t`All caught up`}</h3>
                    {statusLine && <p className='text-muted-foreground mt-1 text-sm'>{statusLine}</p>}
                  </div>
                </div>
                {renderReadingAffordance('recognition')}
                {renderReadingAffordance('production')}
                <div className='mt-4 flex flex-col gap-2'>
                  <Button type='button' size='xl' className='w-full' onClick={openPractice}>
                    <Brain className='h-4 w-4' />
                    {t`Practice`}
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='xl'
                    className='w-full'
                    onClick={() => setCustomOpen(true)}
                  >
                    <SlidersHorizontal className='h-4 w-4' />
                    {t`Custom practice`}
                  </Button>
                </div>
              </section>

              <section className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                <PracticeMetric label={t`Follow-ups`} value={formatCount(reviewsDue)} />
                <PracticeMetric label={t`New today`} value={formatCount(newToday)} />
                <PracticeMetric label={t`Unseen`} value={formatCount(entry.newCount)} />
                <PracticeMetric label={t`Total`} value={formatCount(entry.totalKept)} />
              </section>

              <CustomPracticeOverlay
                open={customOpen}
                onOpenChange={setCustomOpen}
                targetLanguage={targetLanguage}
                productionTotal={productionTotal}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const PracticeMetric = ({ label, value }: { label: string; value: string }) => (
  <div className='bg-card rounded-xl border p-4'>
    <div className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>{label}</div>
    <div className='mt-2 text-2xl font-semibold tabular-nums'>{value}</div>
  </div>
)
