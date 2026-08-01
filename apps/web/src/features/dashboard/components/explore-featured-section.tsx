import { useMemo, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { SeeMoreLink } from '@/components/ui/see-more-link'
import { FilterChip } from '@/components/filter-chip'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { getLocalizedCoverageLanguageName } from '@/features/coverage/utils/coverage-language-names'
import { useSharedContentList } from '@/features/explore/api/explore-hooks'
import { ExploreCard, ExploreCardSkeleton } from '@/features/explore/components/explore-card'

// How many featured entries the dashboard previews; the full catalog lives on
// /explore.
const FEATURED_COUNT = 4

// A new library is still empty at this size — the section retires itself once
// the user has this many sessions of their own.
const MAX_SESSIONS_TO_SHOW = 3

type Props = {
  sessionCount: number
  sessionsLoaded: boolean
}

// Featured shared content for guests and new-ish users: the immediate "here is
// something to try" answer to an empty dashboard. The language chips double as
// the first "what are you learning?" signal — no separate onboarding step.
export const ExploreFeaturedSection = ({ sessionCount, sessionsLoaded }: Props) => {
  const { t, i18n } = useLingui()
  const { data: entries, isLoading } = useSharedContentList()
  const [selected, setSelected] = useState<string | null>(null)

  const featured = useMemo(() => (entries ?? []).filter((entry) => entry.featured), [entries])
  const languages = useMemo(() => [...new Set(featured.map((entry) => entry.language))].sort(), [featured])
  const active = selected !== null && languages.includes(selected) ? selected : null
  const visible = (active ? featured.filter((entry) => entry.language === active) : featured).slice(0, FEATURED_COUNT)

  // Render nothing until both queries can prove the section belongs here — a
  // flash-in/flash-out section is worse than a late one.
  if (!sessionsLoaded || sessionCount >= MAX_SESSIONS_TO_SHOW) return null
  if (!isLoading && featured.length === 0) return null

  return (
    <div className='mt-6'>
      <div className='flex items-baseline justify-between'>
        <h2 className='text-base font-semibold'>{t`Start with shared content`}</h2>
        <SeeMoreLink to='/explore'>{t`Explore all`}</SeeMoreLink>
      </div>
      {languages.length > 1 && (
        <div className='mt-2 flex flex-wrap gap-2'>
          <FilterChip active={active === null} onClick={() => setSelected(null)}>
            {t`All`}
          </FilterChip>
          {languages.map((code) => (
            <FilterChip key={code} active={code === active} onClick={() => setSelected(code)}>
              {getLocalizedCoverageLanguageName(i18n, code)}
            </FilterChip>
          ))}
        </div>
      )}
      <div className='mt-2 grid grid-cols-1 gap-3 md:grid-cols-2'>
        {isLoading && <SkeletonList count={2} renderItem={() => <ExploreCardSkeleton />} />}
        {visible.map((entry) => (
          <ExploreCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
