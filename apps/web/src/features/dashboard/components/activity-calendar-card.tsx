import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { useActivity } from '@/features/stats/api/stats-hooks'

// All day math runs on server-UTC 'YYYY-MM-DD' strings — "today" is the last
// entry of the response's day window, never the client clock, so the calendar
// agrees with the streak and with `pnpm db:advance-day` time travel.
const toUtcDate = (day: string) => new Date(`${day}T00:00:00Z`)
const monthOf = (day: string) => day.slice(0, 7)
const addMonths = (month: string, delta: number): string => {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7)
}
const monthDiff = (a: string, b: string): number => {
  const [aYear, aMonth] = a.split('-').map(Number)
  const [bYear, bMonth] = b.split('-').map(Number)
  return (aYear - bYear) * 12 + (aMonth - bMonth)
}

// Fixed Monday week start (no locale week-info dependency); the header
// initials still localize through i18n.date.
const buildMonthCells = (month: string): Array<{ day: string; dayOfMonth: number } | null> => {
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))
  const leadingBlanks = (first.getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      day: new Date(Date.UTC(year, monthNumber - 1, i + 1)).toISOString().slice(0, 10),
      dayOfMonth: i + 1,
    })),
  ]
}

// 2024-01-01 is a Monday; the seven dates from it label the weekday columns.
const WEEKDAY_ANCHOR_MONDAY = Date.UTC(2024, 0, 1)

type Props = {
  // 'dashboard' shows the Activity title; 'stats' shows the Streak title +
  // the streak-definition caption ("More stats" lives in the dashboard's
  // section header, not in the card).
  variant?: 'dashboard' | 'stats'
}

// Strava-style monthly streak calendar. A day fills iff it had any
// streak-qualifying activity (the response's activeDays — the same source the
// streak pill counts), so the two can never disagree. Today stays an open
// outlined ring until it's earned; days before the account (or before the
// earliest activity, whichever is older — time travel shifts activity but not
// the signup date) and future days render as bare faint numerals. User-level
// on purpose: the streak ignores languages, so the calendar does too.
export const ActivityCalendarCard = ({ variant = 'dashboard' }: Props) => {
  const { t, i18n } = useLingui()
  const { data, isLoading } = useActivity()
  // Offset from the current month (0 = server-today's month), so a midnight
  // refetch that rolls the month over advances an un-navigated card with it.
  const [monthOffset, setMonthOffset] = useState(0)

  if (isLoading) return <ActivityCalendarCardSkeleton variant={variant} />
  if (!data) return null

  const today = data.days.at(-1)!
  const activeDays = new Set(data.activeDays)
  // activeDays is newest-first, so the earliest active day is the last entry.
  const earliestActive = data.activeDays.at(-1)
  const effectiveStart = earliestActive && earliestActive < data.joinedDay ? earliestActive : data.joinedDay

  const currentMonth = monthOf(today)
  const minOffset = monthDiff(monthOf(effectiveStart), currentMonth)
  const clampedOffset = Math.max(minOffset, Math.min(0, monthOffset))
  const displayedMonth = addMonths(currentMonth, clampedOffset)
  const canGoBack = clampedOffset > minOffset
  const canGoForward = clampedOffset < 0

  const cells = buildMonthCells(displayedMonth)
  const monthLabel = i18n.date(toUtcDate(`${displayedMonth}-01`), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const weekdayInitials = Array.from({ length: 7 }, (_, i) =>
    i18n.date(new Date(WEEKDAY_ANCHOR_MONDAY + i * 86_400_000), { weekday: 'narrow', timeZone: 'UTC' })
  )

  const streakDays = data.streakDays

  return (
    <div className='md:bg-card mt-4 flex flex-col md:h-full md:rounded-xl md:border md:p-4'>
      <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-2'>
        <div>
          <h2 className='font-semibold'>{variant === 'dashboard' ? t`Activity` : t`Streak`}</h2>
          <p className='text-muted-foreground text-sm'>{t`All languages`}</p>
        </div>
        {streakDays > 0 && (
          <span className='rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-amber-900 dark:bg-amber-400/15 dark:text-amber-300'>
            {t`${streakDays}-day streak`}
          </span>
        )}
      </div>

      <div className='mt-3 flex items-center justify-between'>
        <button
          type='button'
          onClick={() => setMonthOffset(Math.max(minOffset, clampedOffset - 1))}
          disabled={!canGoBack}
          aria-label={t`Previous month`}
          className={cn(
            'bg-muted flex size-7 items-center justify-center rounded-full transition-colors',
            canGoBack ? 'text-muted-foreground hover:bg-accent active:bg-accent/80' : 'text-muted-foreground/40'
          )}
        >
          <ChevronLeft className='size-4' />
        </button>
        <div className='text-sm font-semibold'>{monthLabel}</div>
        <button
          type='button'
          onClick={() => setMonthOffset(Math.min(0, clampedOffset + 1))}
          disabled={!canGoForward}
          aria-label={t`Next month`}
          className={cn(
            'bg-muted flex size-7 items-center justify-center rounded-full transition-colors',
            canGoForward ? 'text-muted-foreground hover:bg-accent active:bg-accent/80' : 'text-muted-foreground/40'
          )}
        >
          <ChevronRight className='size-4' />
        </button>
      </div>

      <div className='mt-2 grid grid-cols-7 justify-items-center gap-y-1.5'>
        {weekdayInitials.map((initial, i) => (
          <div key={i} className='text-muted-foreground flex h-5 items-center text-[11px] font-semibold'>
            {initial}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} />
          const isToday = cell.day === today
          const isActive = activeDays.has(cell.day)
          const isOutOfRange = cell.day > today || cell.day < effectiveStart
          const fullDate = i18n.date(toUtcDate(cell.day), {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          })
          return (
            <div
              key={cell.day}
              aria-current={isToday ? 'date' : undefined}
              className={cn(
                'flex size-11 items-center justify-center rounded-full text-sm md:size-10',
                isActive && 'bg-primary text-primary-foreground font-semibold',
                !isActive && isToday && 'border-primary border-2 font-bold',
                !isActive && !isToday && isOutOfRange && 'text-muted-foreground/50',
                !isActive && !isToday && !isOutOfRange && 'border-border text-muted-foreground border font-medium'
              )}
            >
              <span aria-hidden>{cell.dayOfMonth}</span>
              <span className='sr-only'>{isActive ? t`${fullDate} — active` : t`${fullDate} — no activity`}</span>
            </div>
          )
        })}
      </div>

      {data.activeDays.length === 0 && (
        <div className='mt-3 rounded-xl bg-yellow-100 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:bg-amber-400/10 dark:text-amber-300'>
          <b className='text-amber-900 dark:text-amber-200'>{t`Today's circle is open.`}</b>{' '}
          {t`Do a practice, or mark words you know while reading, to fill it in — that starts your streak.`}
        </div>
      )}

      {variant === 'stats' && (
        <p className='text-muted-foreground/80 mt-auto pt-3 text-[11px] leading-relaxed'>
          {t`Any activity counts — new terms, practice, exercises, or marking words known. The streak ignores the language filter.`}
        </p>
      )}
    </div>
  )
}

// Mirrors the card (header + nav row + 7×5 circle grid + footer line) so data
// landing doesn't shift the layout.
export const ActivityCalendarCardSkeleton = ({ variant = 'dashboard' }: Props) => (
  <div className='md:bg-card mt-4 flex flex-col md:rounded-xl md:border md:p-4'>
    <div className='flex items-start justify-between'>
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-5 w-24' />
        <Skeleton className='h-4 w-20' />
      </div>
      <Skeleton className='h-6 w-24 rounded-full' />
    </div>
    <div className='mt-3 flex items-center justify-between'>
      <Skeleton className='size-7 rounded-full' />
      <Skeleton className='h-4 w-24' />
      <Skeleton className='size-7 rounded-full' />
    </div>
    <div className='mt-2 grid grid-cols-7 justify-items-center gap-y-1.5'>
      {Array.from({ length: 35 }, (_, i) => (
        <Skeleton key={i} className='size-11 rounded-full md:size-10' />
      ))}
    </div>
    {variant === 'stats' && <Skeleton className='mt-3 h-4 w-full' />}
  </div>
)
