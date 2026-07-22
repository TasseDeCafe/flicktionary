import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { useActivity } from '@/features/stats/api/stats-hooks'
import { getLocalizedCoverageLanguageName } from '@/features/coverage/utils/coverage-language-names'

// The dashboard shows the tail of the fetched window; the stats view renders
// the full 14 days from the same cached response.
const DASHBOARD_DAYS = 7

type Props = {
  // How many of the fetched days to display (tail of the window).
  windowDays?: number
  // Controlled language scope (null = all languages). When provided the card
  // hides its own chips and "More stats" link — the hosting page owns both.
  language?: string | null
}

// Per-day study activity: stacked bars (new terms on top of marked known),
// pressable to inspect a single day — the side column always describes the
// selected day, which defaults to today (outlined). Language chips filter the
// bars; the streak is user-level and ignores the chip.
export const ActivityCard = ({ windowDays = DASHBOARD_DAYS, language }: Props) => {
  const { t, i18n } = useLingui()
  const { data, isLoading } = useActivity()
  const controlled = language !== undefined
  // null = all languages combined.
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  if (isLoading) return <ActivityCardSkeleton windowDays={windowDays} />
  if (!data) return null

  const languages = data.perLanguage.map((entry) => entry.targetLanguage)
  const chosenLanguage = controlled ? language : selectedLanguage
  // A controlled scope is honored even when the window has no activity for it
  // (perLanguage only carries languages with events) — the bars render
  // zero-filled. Falling back to "all" would show other languages' activity
  // under this language's label. Self-managed chips only ever point at
  // languages present in the data, so the membership guard is for them.
  const activeLanguage =
    chosenLanguage !== null && (controlled || languages.includes(chosenLanguage)) ? chosenLanguage : null
  const scoped = activeLanguage
    ? data.perLanguage.filter((entry) => entry.targetLanguage === activeLanguage)
    : data.perLanguage

  const days = data.days.slice(-windowDays)
  const offset = data.days.length - days.length
  const newTerms = days.map((_, i) => scoped.reduce((sum, entry) => sum + (entry.newTerms[offset + i] ?? 0), 0))
  const markedKnown = days.map((_, i) => scoped.reduce((sum, entry) => sum + (entry.markedKnown[offset + i] ?? 0), 0))
  const maxTotal = Math.max(1, ...days.map((_, i) => newTerms[i] + markedKnown[i]))

  const today = days[days.length - 1]
  const activeDay = selectedDay !== null && days.includes(selectedDay) ? selectedDay : today
  const activeIndex = days.indexOf(activeDay)

  const dayLabel = (day: string, options: Intl.DateTimeFormatOptions) =>
    // The strings are server UTC days — format them in UTC or the label could
    // name the neighboring weekday.
    i18n.date(new Date(`${day}T00:00:00Z`), { ...options, timeZone: 'UTC' })

  const streakDays = data.streakDays

  return (
    <div className='bg-card mt-4 rounded-xl border p-4'>
      <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-2'>
        <div>
          <h2 className='font-semibold'>{t`Activity`}</h2>
          <p className='text-muted-foreground text-sm'>
            {windowDays === DASHBOARD_DAYS ? t`This week` : t`Last ${windowDays} days`}
          </p>
        </div>
        {streakDays > 0 && (
          <span className='rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-amber-900 dark:bg-amber-400/15 dark:text-amber-300'>
            {t`${streakDays}-day streak`}
          </span>
        )}
      </div>

      <div className='mt-3 flex items-stretch gap-4'>
        <div className='min-w-0 flex-1'>
          <div className='flex h-36 items-stretch gap-1.5'>
            {days.map((day, i) => {
              const newCount = newTerms[i]
              const knownCount = markedKnown[i]
              const fullDate = dayLabel(day, { weekday: 'long', month: 'short', day: 'numeric' })
              const barLabel = t`${fullDate}: ${newCount} new terms, ${knownCount} marked known`
              return (
                <button
                  key={day}
                  type='button'
                  onClick={() => setSelectedDay(day)}
                  aria-label={barLabel}
                  aria-pressed={day === activeDay}
                  className={cn(
                    'flex h-full min-w-0 flex-1 rounded-full border-2 p-0.5 transition-colors',
                    day === activeDay ? 'border-foreground' : 'border-transparent'
                  )}
                >
                  <span className='bg-muted relative flex w-full flex-col justify-end overflow-hidden rounded-full'>
                    {newCount > 0 && (
                      <span className='w-full bg-teal-700' style={{ height: `${(newCount / maxTotal) * 100}%` }} />
                    )}
                    {knownCount > 0 && (
                      <span className='w-full bg-teal-400' style={{ height: `${(knownCount / maxTotal) * 100}%` }} />
                    )}
                  </span>
                </button>
              )
            })}
          </div>
          <div className='mt-1 flex gap-1.5'>
            {days.map((day) => (
              <div key={day} className='text-muted-foreground min-w-0 flex-1 text-center text-xs font-medium'>
                {dayLabel(day, { weekday: 'narrow' })}
              </div>
            ))}
          </div>
        </div>

        <div className='flex w-24 shrink-0 flex-col justify-center gap-3'>
          <div className='text-muted-foreground text-xs font-medium'>
            {activeDay === today ? t`Today` : dayLabel(activeDay, { weekday: 'short', day: 'numeric' })}
          </div>
          <div>
            <div className='text-lg leading-tight font-bold tabular-nums'>{newTerms[activeIndex]}</div>
            <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
              <span className='size-2 shrink-0 rounded-full bg-teal-700' />
              {t`New terms`}
            </div>
          </div>
          <div>
            <div className='text-lg leading-tight font-bold tabular-nums'>{markedKnown[activeIndex]}</div>
            <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
              <span className='size-2 shrink-0 rounded-full bg-teal-400' />
              {t`Marked known`}
            </div>
          </div>
        </div>
      </div>

      {!controlled && languages.length > 1 && (
        <div className='mt-3 flex flex-wrap gap-2'>
          <ActivityChip active={activeLanguage === null} onClick={() => setSelectedLanguage(null)}>
            {t`All`}
          </ActivityChip>
          {languages.map((code) => (
            <ActivityChip key={code} active={code === activeLanguage} onClick={() => setSelectedLanguage(code)}>
              {getLocalizedCoverageLanguageName(i18n, code)}
            </ActivityChip>
          ))}
        </div>
      )}

      {!controlled && (
        <div className='mt-3 text-right'>
          <Link
            to='/stats'
            className='text-muted-foreground hover:text-foreground active:text-foreground text-sm font-medium transition-colors'
          >
            {t`More stats`}
          </Link>
        </div>
      )}
    </div>
  )
}

const ActivityChip = ({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) => (
  <button
    type='button'
    onClick={onClick}
    className={`shrink-0 rounded-full px-3 py-1 text-sm whitespace-nowrap transition-colors ${
      active
        ? 'bg-yellow-400 font-medium text-yellow-950'
        : 'bg-muted text-foreground hover:bg-accent active:bg-accent/80'
    }`}
  >
    {children}
  </button>
)

// Mirrors the card: header + bar area + labels so data landing doesn't shift
// the layout.
export const ActivityCardSkeleton = ({ windowDays = DASHBOARD_DAYS }: { windowDays?: number }) => (
  <div className='bg-card mt-4 rounded-xl border p-4'>
    <div className='flex items-start justify-between'>
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-5 w-24' />
        <Skeleton className='h-4 w-16' />
      </div>
      <Skeleton className='h-6 w-24 rounded-full' />
    </div>
    <div className='mt-3 flex items-stretch gap-4'>
      <div className='flex h-36 flex-1 items-stretch gap-1.5'>
        {Array.from({ length: windowDays }, (_, i) => (
          <Skeleton key={i} className='h-full min-w-0 flex-1 rounded-full' />
        ))}
      </div>
      <div className='flex w-24 shrink-0 flex-col justify-center gap-3'>
        <Skeleton className='h-4 w-12' />
        <Skeleton className='h-10 w-16' />
        <Skeleton className='h-10 w-16' />
      </div>
    </div>
  </div>
)
