import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { plural } from '@lingui/core/macro'
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
import { Skeleton, SkeletonList } from '@flicktionary/ui/components/skeleton'
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
    recognition: false,
    production: false,
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
  const productionTotal = entry?.productionTotal ?? 0
  const productionDueCount = entry ? entry.productionReviewDueCount + entry.productionLearningDueCount : 0
  const productionNewCount = entry?.productionNewCount ?? 0
  const hasProductionWork = productionDueCount + productionNewCount > 0
  const hasRecognitionWork = dueTermCount > 0 || dailyNewAvailable > 0

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

  const openWarmupContinue = (pool: PracticePool) => {
    void navigate({ to: '/practice/warmup-continue/$targetLanguage', params: { targetLanguage }, search: { pool } })
  }

  // Precedence once nothing is servable: review-limit reached (due work exists
  // only beyond the spent budget) > new-limit reached > all caught up.
  // Learning follow-ups due always count as servable work (budget-exempt).
  const statusLine = (() => {
    if (!entry) return ''
    if (hasRecognitionWork) {
      const parts = [
        dueTermCount > 0 ? plural(dueTermCount, { one: '# review', other: '# reviews' }) : null,
        dailyNewAvailable > 0 ? t`${dailyNewAvailable} new available today` : null,
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
        onClick={() => enterReview(pool, reading.scope ?? 'mixed', 'read')}
        className='mt-3 flex w-full items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-left text-sm text-sky-800 transition-colors hover:bg-sky-100 active:bg-sky-100'
      >
        <BookOpen className='h-4 w-4 shrink-0' />
        {t`Reading in progress (${plural(reading.termCount, { one: '# term', other: '# terms' })}) — continue`}
      </button>
    )
  }

  // Onboarding terms still warming up, per pool. Resumes the warm-up ladder
  // language-wide — distinct from the leech "strengthen them" affordance below,
  // even though both ride the same parked exercise machinery.
  const renderWarmupAffordance = (pool: PracticePool) => {
    const warmingUp = pool === 'recognition' ? (entry?.warmupCount ?? 0) : (entry?.productionWarmupCount ?? 0)
    if (warmingUp <= 0) return null
    return (
      <button
        type='button'
        onClick={() => openWarmupContinue(pool)}
        className='mt-3 flex w-full items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-left text-sm text-sky-800 transition-colors hover:bg-sky-100 active:bg-sky-100'
      >
        <Dumbbell className='h-4 w-4 shrink-0' />
        {pool === 'production'
          ? t`${warmingUp} production term(s) warming up — continue`
          : t`${warmingUp} term(s) warming up — continue`}
      </button>
    )
  }

  const renderParkedAffordance = (pool: PracticePool) => {
    const parked = pool === 'recognition' ? (entry?.parkedCount ?? 0) : (entry?.productionParkedCount ?? 0)
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
            {pool === 'production' ? <Star className='h-4 w-4' /> : <Brain className='h-4 w-4' />}
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
              // Learn-new has work when EITHER unseen citation terms or unseen
              // opt-in extras (enabled forms/pronunciation) exist — extras are
              // served only in learn-new sessions, never by Practice (mixed).
              disabled={
                pool === 'recognition'
                  ? (entry?.newCount ?? 0) + (entry?.optInNewCount ?? 0) === 0
                  : productionNewCount + (entry?.productionOptInNewCount ?? 0) === 0
              }
              onClick={(event) => {
                // Recognition learn-new picks a batch size first (the chosen N
                // bypasses the daily-new budget). The production pool has no
                // daily cap, so it enters directly like before.
                if (pool === 'recognition') {
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

          {isLoading && (
            <>
              <section className='bg-card rounded-xl border p-4'>
                <Skeleton className='h-3 w-32' />
                <div className='mt-3 flex items-start gap-3'>
                  <Skeleton className='mt-1 h-5 w-5 shrink-0 rounded-full' />
                  <div className='min-w-0 flex-1'>
                    <Skeleton className='h-5 w-40' />
                    <Skeleton className='mt-2 h-3 w-28' />
                  </div>
                </div>
                <div className='mt-4 flex flex-wrap gap-2'>
                  <Skeleton className='h-10 w-28' />
                  <Skeleton className='h-10 w-24' />
                  <Skeleton className='h-10 w-20' />
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
              {productionTotal > 0 && (
                <section className='rounded-xl border bg-amber-50/40 p-4 dark:bg-amber-400/10'>
                  <h2 className='text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase'>
                    <Star className='h-3.5 w-3.5 text-amber-600 dark:text-amber-400' />
                    {t`Production practice`}
                  </h2>
                  <p className='text-foreground text-sm'>
                    {hasProductionWork
                      ? t`${plural(productionDueCount, { one: '# review', other: '# reviews' })}, ${productionNewCount} new`
                      : t`${plural(productionTotal, { one: '# production term', other: '# production terms' })}. Nothing to review right now.`}
                  </p>
                  {renderReadingAffordance('production')}
                  {renderWarmupAffordance('production')}
                  {renderParkedAffordance('production')}
                  {renderPoolActions('production')}
                </section>
              )}

              <section className='bg-card rounded-xl border p-4'>
                <h2 className='text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase'>{t`Recognition practice`}</h2>
                <div className='flex items-start gap-3'>
                  {hasRecognitionWork ? (
                    <Brain className='mt-1 h-5 w-5 text-yellow-600 dark:text-yellow-400' />
                  ) : (
                    <CircleCheck className='mt-1 h-5 w-5 text-emerald-600' />
                  )}
                  <div className='min-w-0 flex-1'>
                    <h3 className='font-semibold'>{hasRecognitionWork ? t`Ready to practice` : t`All caught up`}</h3>
                    {statusLine && <p className='text-muted-foreground mt-1 text-sm'>{statusLine}</p>}
                  </div>
                </div>
                {renderReadingAffordance('recognition')}
                {renderWarmupAffordance('recognition')}
                {renderParkedAffordance('recognition')}
                {renderPoolActions('recognition')}
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
                optInNewCount={entry.optInNewCount}
                onConfirm={(batchSize) => {
                  setLearnNewSheet(null)
                  // null batch = extras-only session: enter learn-new without a
                  // count; the citation bucket is empty and only opt-in extras
                  // (which need no daily-cap bypass) are served.
                  enterReview(learnNewSheet?.pool ?? 'recognition', 'learn_new', 'flashcards', batchSize ?? undefined)
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
