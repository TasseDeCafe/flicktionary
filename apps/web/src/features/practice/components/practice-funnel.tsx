import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ChevronRight } from 'lucide-react'
import type { PracticeDueSummaryEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { VocabStage } from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// One stage of the recognition-term lifecycle, colored to rhyme with the
// in-session chips (blue=new intake, amber=warm-up, rose=learning,
// emerald=review) so the two surfaces read as one system.
type StageRow = {
  stage: VocabStage
  label: string
  description: string
  count: number
  dotClassName: string
  barClassName: string | null
  // Optional second line under the label (the Up next row carries the
  // next-session intake so "50 waiting" can't read as a session promise).
  detail?: string | null
}

// The deck pipeline for one language: a slim proportion bar over the five
// ACTIVE stages plus tappable stage rows that open the Vocabulary tab
// pre-filtered (same predicates server-side — the row count and the filtered
// list can't disagree). Unseen is a row but NOT a bar segment: it usually
// dwarfs the active stages by an order of magnitude and would crush them to
// slivers; the funnel's job is showing the shape of the ACTIVE pipeline.
// Recognition lifecycle only — production work shows up in the session plan
// card, not here.
export const PracticeFunnel = ({
  entry,
  targetLanguage,
  nextSessionIntake,
}: {
  entry: PracticeDueSummaryEntry
  targetLanguage: string
  // plannedIntroductions.recognition from the session-plan preview; null while
  // the preview loads.
  nextSessionIntake: number | null
}) => {
  const { t } = useLingui()
  const navigate = useNavigate()

  const intake = nextSessionIntake ?? 0
  const rows: StageRow[] = [
    {
      stage: 'up_next',
      label: t`Up next`,
      description: t`Waiting to be introduced, in this order`,
      count: entry.upNextCount,
      dotClassName: 'bg-blue-500',
      barClassName: 'bg-blue-500',
      detail:
        nextSessionIntake != null && entry.upNextCount > 0
          ? intake > 0
            ? t`${intake} enter your next session`
            : t`none enter your next session yet`
          : null,
    },
    {
      stage: 'warming_up',
      label: t`Warming up`,
      description: t`In introduction exercises before their first flashcard`,
      count: entry.warmupCount,
      dotClassName: 'bg-amber-500',
      barClassName: 'bg-amber-500',
    },
    {
      stage: 'learning',
      label: t`Learning`,
      description: t`Short-term follow-ups, coming back within days`,
      count: entry.learningCount,
      dotClassName: 'bg-rose-500',
      barClassName: 'bg-rose-500',
    },
    {
      stage: 'review',
      label: t`Review`,
      description: t`Graduated to long-term review`,
      count: entry.reviewCount,
      dotClassName: 'bg-emerald-500',
      barClassName: 'bg-emerald-500',
    },
    {
      stage: 'strengthen',
      label: t`Strengthen`,
      description: t`Set aside after repeated misses`,
      count: entry.parkedCount,
      dotClassName: 'bg-violet-500',
      barClassName: 'bg-violet-500',
    },
    {
      stage: 'unseen',
      label: t`Unseen`,
      description: t`Saved but not queued yet`,
      count: entry.unseenCount,
      dotClassName: 'bg-muted-foreground/40',
      barClassName: null,
    },
  ]

  const barSegments = rows.filter((row) => row.barClassName != null && row.count > 0)
  const barTotal = barSegments.reduce((n, row) => n + row.count, 0)
  // Strengthen hides at 0 (a healthy deck has no leeches — no need to
  // advertise the concept); the other stages stay visible as zeros so the
  // pipeline shape is stable.
  const visibleRows = rows.filter((row) => row.stage !== 'strengthen' || row.count > 0)

  const openStage = (stage: VocabStage) =>
    void navigate({ to: '/vocabulary', search: { lang: targetLanguage, status: stage } })

  return (
    <section className='bg-card rounded-xl border'>
      <div className='px-4 pt-4'>
        <h3 className='font-semibold'>{t`Your vocabulary`}</h3>
        {/* The proportion bar covers the five active stages; 2px gaps keep
            adjacent segments separable without relying on hue alone. */}
        {barTotal > 0 && (
          <div className='mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full'>
            {barSegments.map((segment) => (
              <div
                key={segment.stage}
                className={cn('h-full rounded-[1px] first:rounded-l-full last:rounded-r-full', segment.barClassName)}
                style={{ width: `${(segment.count / barTotal) * 100}%` }}
              />
            ))}
          </div>
        )}
      </div>
      <div className='mt-2 flex flex-col divide-y'>
        {visibleRows.map((row) => (
          <button
            key={row.stage}
            type='button'
            onClick={() => openStage(row.stage)}
            className='flex min-h-[52px] items-center gap-3 px-4 py-2 text-left transition-colors first:border-t last:rounded-b-xl hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-white/5 dark:active:bg-white/10'
          >
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', row.dotClassName)} />
            <span className='min-w-0 flex-1'>
              <span className='block text-sm font-medium'>{row.label}</span>
              <span className='text-muted-foreground block truncate text-xs'>{row.detail ?? row.description}</span>
            </span>
            <span className='text-sm font-semibold tabular-nums'>{row.count.toLocaleString()}</span>
            <ChevronRight className='text-muted-foreground h-4 w-4 shrink-0' />
          </button>
        ))}
      </div>
    </section>
  )
}
