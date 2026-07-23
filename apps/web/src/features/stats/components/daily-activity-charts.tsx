import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { I18n } from '@lingui/core'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { useActivity, type LanguageActivity } from '@/features/stats/api/stats-hooks'

const WINDOW_OPTIONS = [14, 30, 90] as const
type WindowDays = (typeof WINDOW_OPTIONS)[number]

type SeriesKey = 'newTerms' | 'markedKnown' | 'practiced'

const sumSeries = (scoped: LanguageActivity[], key: SeriesKey, offset: number, length: number): number[] =>
  Array.from({ length }, (_, i) => scoped.reduce((sum, entry) => sum + (entry[key][offset + i] ?? 0), 0))

// The strings are server UTC days — format in UTC or the label could name the
// neighboring day.
const dayLabel = (i18n: I18n, day: string, options: Intl.DateTimeFormatOptions) =>
  i18n.date(new Date(`${day}T00:00:00Z`), { ...options, timeZone: 'UTC' })

// Vertical hairlines at identical x-positions across all three charts so the
// stack reads as one aligned time axis: week starts (Mondays) at 14/30 days,
// month starts at 90.
const gridlineIndexes = (days: string[], windowDays: WindowDays): number[] =>
  days.reduce<number[]>((indexes, day, i) => {
    if (i === 0) return indexes
    const date = new Date(`${day}T00:00:00Z`)
    const isBoundary = windowDays === 90 ? date.getUTCDate() === 1 : date.getUTCDay() === 1
    if (isBoundary) indexes.push(i)
    return indexes
  }, [])

type Props = {
  // Page-level language scope (null = all languages summed).
  language: string | null
}

// Three per-metric bar charts, each with its OWN y-scale — never stacked and
// never sharing an axis, so a 400-word marking sweep can't flatten the
// few-terms-a-day line. One fetch serves all windows: the selector just
// slices the response's 90-day series.
export const DailyActivityCharts = ({ language }: Props) => {
  const { t, i18n } = useLingui()
  const { data, isLoading } = useActivity()
  const [windowDays, setWindowDays] = useState<WindowDays>(30)

  if (isLoading) return <DailyActivityChartsSkeleton />
  if (!data) return null

  const scoped = language ? data.perLanguage.filter((entry) => entry.targetLanguage === language) : data.perLanguage
  const days = data.days.slice(-windowDays)
  const offset = data.days.length - days.length
  const gridlines = gridlineIndexes(days, windowDays)

  const newTerms = sumSeries(scoped, 'newTerms', offset, days.length)
  const markedKnown = sumSeries(scoped, 'markedKnown', offset, days.length)
  const practiced = sumSeries(scoped, 'practiced', offset, days.length)

  const newTermsTotal = newTerms.reduce((a, b) => a + b, 0).toLocaleString()
  const markedKnownTotal = markedKnown.reduce((a, b) => a + b, 0).toLocaleString()
  const practicedTotal = practiced.reduce((a, b) => a + b, 0).toLocaleString()

  return (
    <div className='md:bg-card mt-4 flex flex-col gap-4 md:h-full md:rounded-xl md:border md:p-4'>
      <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-2'>
        <div>
          <h2 className='font-semibold'>{t`Daily activity`}</h2>
          <p className='text-muted-foreground text-sm'>{t`Each chart has its own scale`}</p>
        </div>
        {/* Full-width segmented control on mobile (it wraps onto its own
            line); compact inline pill next to the title on desktop. */}
        <div className='bg-muted flex w-full rounded-full p-0.5 md:w-auto'>
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option}
              type='button'
              onClick={() => setWindowDays(option)}
              aria-pressed={option === windowDays}
              className={cn(
                'flex-1 rounded-full px-3 py-1.5 text-xs whitespace-nowrap transition-colors md:flex-none md:py-1',
                option === windowDays
                  ? 'bg-background text-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground active:text-foreground font-medium'
              )}
            >
              {t`${option} days`}
            </button>
          ))}
        </div>
      </div>

      <MetricChart
        label={t`New terms`}
        totalValue={newTermsTotal}
        totalUnit={t`saved`}
        values={newTerms}
        days={days}
        gridlines={gridlines}
        dotClassName='bg-teal-700'
        barClassName='bg-teal-700'
      />
      <MetricChart
        label={t`Marked known`}
        totalValue={markedKnownTotal}
        totalUnit={t`words`}
        values={markedKnown}
        days={days}
        gridlines={gridlines}
        dotClassName='bg-teal-400'
        barClassName='bg-teal-400'
        className='border-t pt-4'
      />
      <div className='border-t pt-4'>
        <MetricChart
          label={t`Practiced`}
          totalValue={practicedTotal}
          totalUnit={t`cards & exercises`}
          values={practiced}
          days={days}
          gridlines={gridlines}
          dotClassName='bg-indigo-500 dark:bg-indigo-400'
          barClassName='bg-indigo-500 dark:bg-indigo-400'
        />
        <div className='text-muted-foreground mt-1.5 flex justify-between text-[10px] font-semibold'>
          <span>{dayLabel(i18n, days[0], { month: 'short', day: 'numeric' })}</span>
          <span>{dayLabel(i18n, days[days.length - 1], { month: 'short', day: 'numeric' })}</span>
        </div>
      </div>
    </div>
  )
}

const MetricChart = ({
  label,
  totalValue,
  totalUnit,
  values,
  days,
  gridlines,
  dotClassName,
  barClassName,
  className,
}: {
  label: string
  totalValue: string
  totalUnit: string
  values: number[]
  days: string[]
  gridlines: number[]
  dotClassName: string
  barClassName: string
  className?: string
}) => {
  const { t, i18n } = useLingui()
  const max = Math.max(1, ...values)
  const peakLabel = max.toLocaleString()
  return (
    <div className={className}>
      <div className='flex items-baseline justify-between gap-4'>
        <div className='flex items-center gap-2 text-sm font-semibold'>
          <span className={cn('size-2.5 shrink-0 rounded-full', dotClassName)} />
          {label}
        </div>
        <div className='text-muted-foreground text-xs tabular-nums'>
          <b className='text-foreground font-semibold'>{totalValue}</b> {totalUnit}
        </div>
      </div>
      {/* The bars are presentation-only; the sr-only list below carries the
          daily series for screen readers (the old chart's per-bar buttons
          did this via aria-labels). */}
      <div aria-hidden className='relative mt-2 h-20'>
        <div className='bg-border absolute inset-x-0 bottom-0 h-px' />
        {gridlines.map((index) => (
          <div
            key={index}
            className='bg-border/60 absolute inset-y-0 w-px'
            style={{ left: `${(index / values.length) * 100}%` }}
          />
        ))}
        <span className='text-muted-foreground absolute -top-1 right-0 text-[10px] font-semibold'>
          {t`peak ${peakLabel}/day`}
        </span>
        <div className='absolute inset-x-0 top-4 bottom-0 flex items-end'>
          {values.map((value, i) => (
            <div key={days[i]} className='flex h-full min-w-0 flex-1 items-end justify-center px-px'>
              {value > 0 && (
                <div
                  className={cn('w-full max-w-3.5 min-w-px rounded-t-sm', barClassName)}
                  style={{ height: `${Math.max(3, (value / max) * 100)}%` }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <ul className='sr-only'>
        {values.map((value, i) => (
          <li key={days[i]}>
            {dayLabel(i18n, days[i], { month: 'short', day: 'numeric' })}: {value.toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  )
}

// Mirrors the card: header + selector + three chart blocks.
export const DailyActivityChartsSkeleton = () => (
  <div className='md:bg-card mt-4 flex flex-col gap-4 md:rounded-xl md:border md:p-4'>
    <div className='flex flex-wrap items-start justify-between gap-2'>
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-5 w-28' />
        <Skeleton className='h-4 w-40' />
      </div>
      <Skeleton className='h-8 w-full rounded-full md:h-7 md:w-48' />
    </div>
    {Array.from({ length: 3 }, (_, i) => (
      <div key={i} className='flex flex-col gap-2'>
        <Skeleton className='h-4 w-32' />
        <Skeleton className='h-20 w-full' />
      </div>
    ))}
  </div>
)
