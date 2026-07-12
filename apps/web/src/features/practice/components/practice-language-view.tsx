import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { BookOpen, Brain, ChevronLeft, CircleCheck, SlidersHorizontal } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton, SkeletonList } from '@flicktionary/ui/components/skeleton'
import type { PracticePool } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { useDueSummary, usePreviewPracticeQueue } from '../api/practice-hooks'
import { CustomPracticeOverlay } from './custom-practice-overlay'
import { PracticeFunnel } from './practice-funnel'
import { SessionPlanCard } from './session-plan-card'

// The per-language landing: ONE primary Practice button entering the composed
// queue (gate exercises + due flashcards, production-first — the system makes
// the strategic decision), a Custom practice overlay for every secondary mode,
// and two truth-telling surfaces replacing the old counter tiles:
//   - the session-plan card: what pressing Practice will actually serve, in
//     the same four buckets as the in-session chips (server-computed from the
//     same plan the compose executes — the numbers can't disagree);
//   - the funnel: the deck's stage pipeline, each row deep-linking into the
//     Vocabulary tab pre-filtered to that stage.
export const PracticeLanguageView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/language/$targetLanguage' })
  const { data: summary, isLoading } = useDueSummary()
  const [customOpen, setCustomOpen] = useState(false)

  const entry = summary?.find((row) => row.targetLanguage === targetLanguage) ?? null
  const languageName = getLanguageName(targetLanguage)
  const { data: preview, isLoading: previewLoading } = usePreviewPracticeQueue(entry ? targetLanguage : null)

  // Servable work = what the next session actually contains (the preview runs
  // the compose's own plan). The old client-side budget math lived here; it
  // now has exactly one home, server-side.
  const previewTotal = preview
    ? preview.counts.new + preview.counts.warmup + preview.counts.learning + preview.counts.review
    : 0
  const hasWork = previewTotal > 0
  const productionTotal = entry?.productionTotal ?? 0

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
              <section className='bg-card rounded-xl border p-4'>
                <Skeleton className='h-5 w-36' />
                <Skeleton className='mt-3 h-2.5 w-full rounded-full' />
                <SkeletonList count={5} className='mt-4 h-10 w-full' />
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
                  {hasWork || previewLoading ? (
                    <Brain className='mt-1 h-5 w-5 text-yellow-600 dark:text-yellow-400' />
                  ) : (
                    <CircleCheck className='mt-1 h-5 w-5 text-emerald-600' />
                  )}
                  <div className='min-w-0 flex-1'>
                    <h3 className='font-semibold'>
                      {hasWork || previewLoading ? t`Your next session` : t`All caught up`}
                    </h3>
                  </div>
                </div>
                <div className='mt-3'>
                  <SessionPlanCard preview={preview} isLoading={previewLoading} />
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
                    size='lg'
                    className='w-full'
                    onClick={() => setCustomOpen(true)}
                  >
                    <SlidersHorizontal className='h-4 w-4' />
                    {t`Custom practice`}
                  </Button>
                </div>
              </section>

              <PracticeFunnel
                entry={entry}
                targetLanguage={targetLanguage}
                nextSessionIntake={preview ? preview.plannedIntroductions.recognition : null}
              />

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
