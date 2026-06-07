import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import {
  BookOpen,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleCheck,
  Dumbbell,
  History,
  Layers,
  Sparkles,
  Star,
} from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import type { FloatingSheetAnchor } from '@flicktionary/ui/components/floating-sheet'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getPracticeLimitsForLanguage } from '@/features/sessions/utils/practice-limits-pref'
import type {
  PracticeDueSummaryEntry,
  PracticePool,
  ReviewScope,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { useDueSummary } from '../api/practice-hooks'
import { LearnNewBatchSheet } from './learn-new-batch-sheet'

type RenderMode = 'read' | 'flashcards'

const formatCount = (count: number) => count.toLocaleString()

const getDailyNewAvailable = (entry: PracticeDueSummaryEntry, maxNewTerms: number) => {
  if (maxNewTerms <= 0) return 0
  const remainingDailyNewTerms = Math.max(0, maxNewTerms - entry.newIntroducedTodayCount)
  return Math.min(entry.newCount, remainingDailyNewTerms)
}

export const PracticeLanguageView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/language/$targetLanguage' })
  const { data: summary, isLoading } = useDueSummary()
  const { data: prefs } = useGetUserPrefs()

  // Per-pool "More" disclosure. Lives on the parent because nested component
  // definitions remount (and would drop their state) on every render.
  const [moreOpenByPool, setMoreOpenByPool] = useState<Record<PracticePool, boolean>>({
    passive: false,
    active: false,
  })
  // Learn-new batch sheet state — on the parent for the same remount reason.
  const [learnNewSheet, setLearnNewSheet] = useState<{ pool: PracticePool; anchor: FloatingSheetAnchor } | null>(null)

  const entry = summary?.find((row) => row.targetLanguage === targetLanguage) ?? null
  const languageName = getLanguageName(targetLanguage)
  const { maxNewTerms, maxReviewTerms } = getPracticeLimitsForLanguage(prefs, targetLanguage)

  const dailyNewAvailable = entry ? getDailyNewAvailable(entry, maxNewTerms) : 0
  // The review-due count is capped by what's left of today's review budget —
  // due cards beyond the spent budget won't be served until tomorrow, so the
  // landing must not advertise them as ready work.
  const reviewBudgetLeft = Math.max(0, maxReviewTerms - (entry?.reviewedTodayCount ?? 0))
  const servableReviewDue = entry ? Math.min(entry.reviewDueCount, reviewBudgetLeft) : 0
  const dueTermCount = entry ? servableReviewDue + entry.learningDueCount : 0
  const activeTotal = entry?.activeTotal ?? 0
  const activeDueCount = entry ? entry.activeReviewDueCount + entry.activeLearningDueCount : 0
  const activeNewCount = entry?.activeNewCount ?? 0
  const hasActiveWork = activeDueCount + activeNewCount > 0
  const hasPassiveWork = dueTermCount > 0 || dailyNewAvailable > 0

  const handleBack = () => void navigate({ to: '/practice' })

  // The primary button always enters flashcards over the mixed scope — the
  // queue itself decides what to serve. The secondary disclosure exposes the
  // explicit scope/mode combinations for users who want them.
  const enterReview = (pool: PracticePool, scope: ReviewScope, mode: RenderMode, count?: number) => {
    void navigate({
      to: '/practice/review/$targetLanguage',
      params: { targetLanguage },
      search: { pool, scope, mode, count },
    })
  }

  const openHistory = (pool: PracticePool) => {
    void navigate({ to: '/practice/history/$targetLanguage', params: { targetLanguage }, search: { pool } })
  }

  const openStrengthen = (pool: PracticePool) => {
    void navigate({ to: '/practice/strengthen/$targetLanguage', params: { targetLanguage }, search: { pool } })
  }

  // Precedence once nothing is servable: review-limit reached (due work exists
  // only beyond the spent budget) > new-limit reached > all caught up.
  // Learning follow-ups due always count as servable work (budget-exempt).
  const statusLine = (() => {
    if (!entry) return ''
    if (hasPassiveWork) {
      const parts = [
        dueTermCount > 0 ? t`${dueTermCount} due` : null,
        dailyNewAvailable > 0 ? t`${dailyNewAvailable} new available today` : null,
      ].filter((p): p is string => p != null)
      return parts.join(' · ')
    }
    if (entry.reviewDueCount > 0 && reviewBudgetLeft <= 0) return t`Daily review limit reached.`
    if (entry.newCount > 0 && maxNewTerms > 0) return t`Daily new limit reached.`
    return t`No terms are ready right now.`
  })()

  const renderParkedAffordance = (pool: PracticePool) => {
    const parked = pool === 'passive' ? (entry?.parkedCount ?? 0) : (entry?.activeParkedCount ?? 0)
    if (parked <= 0) return null
    return (
      <button
        type='button'
        onClick={() => openStrengthen(pool)}
        className='mt-3 flex w-full items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-left text-sm text-violet-800 transition-colors hover:bg-violet-100 active:bg-violet-100'
      >
        <Dumbbell className='h-4 w-4 shrink-0' />
        {t`${parked} word(s) parked — strengthen them`}
      </button>
    )
  }

  const renderPoolActions = (pool: PracticePool) => {
    const moreOpen = moreOpenByPool[pool]
    return (
      <div className='mt-4 flex flex-col gap-2'>
        <div className='flex flex-col gap-2 sm:flex-row sm:flex-wrap'>
          <Button type='button' size='lg' onClick={() => enterReview(pool, 'mixed', 'flashcards')}>
            {pool === 'active' ? <Star className='h-4 w-4' /> : <Brain className='h-4 w-4' />}
            {t`Practice`}
          </Button>
          <Button type='button' variant='outline' size='lg' onClick={() => openHistory(pool)}>
            <History className='h-4 w-4' />
            {t`History`}
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='lg'
            onClick={() => setMoreOpenByPool((prev) => ({ ...prev, [pool]: !prev[pool] }))}
          >
            {moreOpen ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
            {t`More`}
          </Button>
        </div>
        {moreOpen && (
          <div className='flex flex-wrap gap-2'>
            <Button type='button' variant='outline' size='sm' onClick={() => enterReview(pool, 'mixed', 'read')}>
              <BookOpen className='h-4 w-4' />
              {t`Read`}
            </Button>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => enterReview(pool, 'review_due', 'flashcards')}
            >
              <Layers className='h-4 w-4' />
              {t`Review only`}
            </Button>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={pool === 'passive' ? (entry?.newCount ?? 0) === 0 : activeNewCount === 0}
              onClick={(event) => {
                // Passive learn-new picks a batch size first (the chosen N
                // bypasses the daily-new budget). The active pool has no daily
                // cap, so it enters directly like before.
                if (pool === 'passive') {
                  setLearnNewSheet({ pool, anchor: event.currentTarget.getBoundingClientRect() })
                  return
                }
                enterReview(pool, 'learn_new', 'flashcards')
              }}
            >
              <Sparkles className='h-4 w-4' />
              {t`Learn new`}
            </Button>
          </div>
        )}
      </div>
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

          {isLoading && <div className='text-muted-foreground py-8 text-center text-sm'>{t`Loading…`}</div>}

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
              {activeTotal > 0 && (
                <section className='rounded-xl border bg-amber-50/40 p-4 dark:bg-amber-400/10'>
                  <h2 className='text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase'>
                    <Star className='h-3.5 w-3.5 text-amber-600 dark:text-amber-400' />
                    {t`Active vocabulary`}
                  </h2>
                  <p className='text-foreground text-sm'>
                    {hasActiveWork
                      ? t`${activeDueCount} due, ${activeNewCount} new`
                      : t`${activeTotal} active term(s). Nothing due right now.`}
                  </p>
                  {renderParkedAffordance('active')}
                  {renderPoolActions('active')}
                </section>
              )}

              <section className='bg-card rounded-xl border p-4'>
                <h2 className='text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase'>{t`Passive vocabulary`}</h2>
                <div className='flex items-start gap-3'>
                  {hasPassiveWork ? (
                    <Brain className='mt-1 h-5 w-5 text-yellow-600 dark:text-yellow-400' />
                  ) : (
                    <CircleCheck className='mt-1 h-5 w-5 text-emerald-600' />
                  )}
                  <div className='min-w-0 flex-1'>
                    <h3 className='font-semibold'>{hasPassiveWork ? t`Ready to practice` : t`All caught up`}</h3>
                    {statusLine && <p className='text-muted-foreground mt-1 text-sm'>{statusLine}</p>}
                  </div>
                </div>
                {renderParkedAffordance('passive')}
                {renderPoolActions('passive')}
              </section>

              <section className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                <PracticeMetric label={t`Follow-ups`} value={formatCount(dueTermCount)} />
                <PracticeMetric label={t`New today`} value={formatCount(dailyNewAvailable)} />
                <PracticeMetric label={t`Unseen`} value={formatCount(entry.newCount)} />
                <PracticeMetric label={t`Total`} value={formatCount(entry.totalKept)} />
              </section>

              <LearnNewBatchSheet
                open={learnNewSheet != null}
                onOpenChange={(open) => {
                  if (!open) setLearnNewSheet(null)
                }}
                anchor={learnNewSheet?.anchor ?? null}
                newCount={entry.newCount}
                onConfirm={(batchSize) => {
                  setLearnNewSheet(null)
                  enterReview(learnNewSheet?.pool ?? 'passive', 'learn_new', 'flashcards', batchSize)
                }}
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
