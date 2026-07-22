import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { SeeMoreLink } from '@/components/ui/see-more-link'
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
// pressable to inspect a single day — the stats row under the bars always
// describes the selected day, which defaults to today (outlined). Language
// chips filter the bars; the streak is user-level and ignores the chip. On
// mobile the card chrome drops, matching the coverage card. On desktop the
// card stretches to the coverage card's height and the bars absorb the slack.
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
  const isLongWindow = days.length > DASHBOARD_DAYS
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
  // Label-first with localized counts, matching the coverage legend's wording
  // style ("Studied 1,124").
  const selectedNewTermsLabel = newTerms[activeIndex].toLocaleString()
  const selectedMarkedKnownLabel = markedKnown[activeIndex].toLocaleString()

  return (
    <div className='md:bg-card mt-4 flex flex-col md:h-full md:rounded-xl md:border md:p-4'>
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

      <div className='mt-3 flex flex-1 flex-col'>
        {/* Heights flow through flex stretch (row min-height → buttons →
            ring → track), never h-full percentages: a percentage chain needs
            a definite ancestor height and collapses on pages where the card
            isn't grid-stretched (the stats view). */}
        <div className='flex min-h-52 flex-1 items-stretch'>
          {days.map((day, i) => {
            const newCount = newTerms[i]
            const knownCount = markedKnown[i]
            const total = newCount + knownCount
            const fullDate = dayLabel(day, { weekday: 'long', month: 'short', day: 'numeric' })
            const barLabel = t`${fullDate}: ${newCount} new terms, ${knownCount} marked known`
            return (
              <button
                key={day}
                type='button'
                onClick={() => setSelectedDay(day)}
                aria-label={barLabel}
                aria-pressed={day === activeDay}
                className='flex min-w-0 flex-1 justify-center'
              >
                {/* The selection ring hugs the bar (not the hit area) with a
                    ring of whitespace between border and track. */}
                {/* Windows longer than a week compact their ring/track below
                    md: the ring's fixed chrome (padding+border) must fit a
                    14-column phone layout or it overlaps the neighboring
                    bars. A 7-day week always has room for the full ring. */}
                <span
                  className={cn(
                    'flex border-2 transition-colors',
                    isLongWindow ? 'rounded-lg p-1 md:rounded-md md:p-2' : 'rounded-md p-2',
                    day === activeDay ? 'border-foreground' : 'border-transparent'
                  )}
                >
                  <span
                    className={cn('bg-muted relative self-stretch rounded-sm', isLongWindow ? 'w-3.5 md:w-5' : 'w-5')}
                  >
                    {/* The filled stack is one pill riding the flatter track,
                        so its rounding survives regardless of segment split. */}
                    {total > 0 && (
                      <span
                        className='absolute inset-x-0 bottom-0 flex min-h-3 flex-col overflow-hidden rounded-sm'
                        style={{ height: `${(total / maxTotal) * 100}%` }}
                      >
                        {newCount > 0 && <span className='w-full bg-teal-700' style={{ flexGrow: newCount }} />}
                        {knownCount > 0 && <span className='w-full bg-teal-400' style={{ flexGrow: knownCount }} />}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        <div className='mt-1 flex'>
          {days.map((day) => (
            <div key={day} className='text-muted-foreground min-w-0 flex-1 text-center text-xs font-medium'>
              {dayLabel(day, { weekday: 'narrow' })}
            </div>
          ))}
        </div>
      </div>

      {/* Selected-day stats, styled exactly like the coverage card's legend
          row so the two cards read as one system. */}
      <div className='text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs tabular-nums'>
        <span className='font-medium'>
          {activeDay === today ? t`Today` : dayLabel(activeDay, { weekday: 'short', day: 'numeric' })}
        </span>
        <span className='flex items-center gap-1.5'>
          <span className='size-2.5 shrink-0 rounded-full bg-teal-700' />
          {t`New terms ${selectedNewTermsLabel}`}
        </span>
        <span className='flex items-center gap-1.5'>
          <span className='size-2.5 shrink-0 rounded-full bg-teal-400' />
          {t`Marked known ${selectedMarkedKnownLabel}`}
        </span>
        {!controlled && <SeeMoreLink to='/stats' className='ml-auto'>{t`More stats`}</SeeMoreLink>}
      </div>

      {!controlled && languages.length > 1 && (
        <div className='flex flex-wrap justify-center gap-2 pt-3'>
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

// Mirrors the card: header + bar area + stats row so data landing doesn't
// shift the layout.
export const ActivityCardSkeleton = ({ windowDays = DASHBOARD_DAYS }: { windowDays?: number }) => (
  <div className='md:bg-card mt-4 flex flex-col md:rounded-xl md:border md:p-4'>
    <div className='flex items-start justify-between'>
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-5 w-24' />
        <Skeleton className='h-4 w-16' />
      </div>
      <Skeleton className='h-6 w-24 rounded-full' />
    </div>
    <div className='mt-3 flex h-56 items-stretch justify-around'>
      {Array.from({ length: windowDays }, (_, i) => (
        <Skeleton key={i} className='h-full w-5 rounded-full' />
      ))}
    </div>
    <Skeleton className='mt-3 h-4 w-56' />
  </div>
)
