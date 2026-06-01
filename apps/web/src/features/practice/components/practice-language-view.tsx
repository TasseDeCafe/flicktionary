import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { BookOpen, Brain, ChevronLeft, CircleCheck, History, Layers, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import type {
  PracticeDueSummaryEntry,
  PracticePool,
  ReviewScope,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { useDueSummary } from '../api/practice-hooks'

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

  const [scope, setScope] = useState<ReviewScope>('mixed')
  const [mode, setMode] = useState<RenderMode>('read')

  const entry = summary?.find((row) => row.targetLanguage === targetLanguage) ?? null
  const languageName = getLanguageName(targetLanguage)
  const maxNewTerms = prefs?.practiceMaxNewTerms ?? 20

  const dailyNewAvailable = entry ? getDailyNewAvailable(entry, maxNewTerms) : 0
  const dueTermCount = entry ? entry.reviewDueCount + entry.learningDueCount : 0
  const activeTotal = entry?.activeTotal ?? 0
  const activeDueCount = entry ? entry.activeReviewDueCount + entry.activeLearningDueCount : 0
  const activeNewCount = entry?.activeNewCount ?? 0
  const hasActiveWork = activeDueCount + activeNewCount > 0
  const hasPassiveWork = dueTermCount > 0 || dailyNewAvailable > 0

  const handleBack = () => void navigate({ to: '/practice' })

  const enterReview = (pool: PracticePool) => {
    void navigate({ to: '/practice/review/$targetLanguage', params: { targetLanguage }, search: { pool, scope, mode } })
  }

  const openHistory = (pool: PracticePool) => {
    void navigate({ to: '/practice/history/$targetLanguage', params: { targetLanguage }, search: { pool } })
  }

  const statusLine = (() => {
    if (!entry) return ''
    if (hasPassiveWork) {
      const parts = [
        dueTermCount > 0 ? t`${dueTermCount} due` : null,
        dailyNewAvailable > 0 ? t`${dailyNewAvailable} new available today` : null,
      ].filter((p): p is string => p != null)
      return parts.join(' · ')
    }
    if (entry.newCount > 0 && maxNewTerms > 0) return t`Daily new limit reached.`
    return t`No terms are ready right now.`
  })()

  const ScopeButton = ({ value, label }: { value: ReviewScope; label: string }) => (
    <button
      type='button'
      onClick={() => setScope(value)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        scope === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
    </button>
  )

  const ModeButton = ({ value, label, icon }: { value: RenderMode; label: string; icon: React.ReactNode }) => (
    <button
      type='button'
      onClick={() => setMode(value)}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        mode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {icon}
      {label}
    </button>
  )

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
                  {hasPassiveWork ? (
                    <Brain className='mt-1 h-5 w-5 text-yellow-600' />
                  ) : (
                    <CircleCheck className='mt-1 h-5 w-5 text-emerald-600' />
                  )}
                  <div className='min-w-0 flex-1'>
                    <h3 className='font-semibold'>{hasPassiveWork ? t`Ready to practice` : t`All caught up`}</h3>
                    {statusLine && <p className='text-muted-foreground mt-1 text-sm'>{statusLine}</p>}
                  </div>
                </div>

                <div className='mt-4 flex flex-col gap-3'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-muted-foreground text-xs font-medium'>{t`Scope`}</span>
                    <div className='flex items-center gap-1 rounded-lg bg-gray-100 p-1'>
                      <ScopeButton value='mixed' label={t`Mixed`} />
                      <ScopeButton value='review_due' label={t`Review`} />
                      <ScopeButton value='learn_new' label={t`Learn new`} />
                    </div>
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-muted-foreground text-xs font-medium'>{t`Mode`}</span>
                    <div className='flex items-center gap-1 rounded-lg bg-gray-100 p-1'>
                      <ModeButton value='read' label={t`Read`} icon={<BookOpen className='h-4 w-4' />} />
                      <ModeButton value='flashcards' label={t`Flashcards`} icon={<Layers className='h-4 w-4' />} />
                    </div>
                  </div>
                </div>

                <div className='mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap'>
                  <Button type='button' size='lg' onClick={() => enterReview('passive')}>
                    <Brain className='h-4 w-4' />
                    {t`Practice`}
                  </Button>
                  <Button type='button' variant='outline' size='lg' onClick={() => openHistory('passive')}>
                    <History className='h-4 w-4' />
                    {t`History`}
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
                    {hasActiveWork
                      ? t`${activeDueCount} due, ${activeNewCount} new`
                      : t`${activeTotal} active term(s). Nothing due right now.`}
                  </p>
                  <div className='mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap'>
                    <Button type='button' size='lg' disabled={!hasActiveWork} onClick={() => enterReview('active')}>
                      <Star className='h-4 w-4' />
                      {t`Drill active terms`}
                    </Button>
                    <Button type='button' variant='outline' size='lg' onClick={() => openHistory('active')}>
                      <History className='h-4 w-4' />
                      {t`History`}
                    </Button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const PracticeMetric = ({ label, value }: { label: string; value: string }) => (
  <div className='rounded-xl border bg-white p-4'>
    <div className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>{label}</div>
    <div className='mt-2 text-2xl font-semibold tabular-nums'>{value}</div>
  </div>
)
