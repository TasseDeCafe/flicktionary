import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { PageContainer } from '@/components/page-container'
import { FilterChip } from '@/components/filter-chip'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { useQualifyingCoverage, type LanguageCoverage } from '@/features/coverage/api/coverage-hooks'
import { CoverageDotGrid } from '@/features/coverage/components/coverage-canvas'
import { buildStateArray, CARD_COMPACT_RULE } from '@/features/coverage/utils/coverage-render'
import { getLocalizedCoverageLanguageName } from '@/features/coverage/utils/coverage-language-names'
import { useActivity } from '../api/stats-hooks'
import { DailyActivityCharts } from './daily-activity-charts'
import { ActivityCalendarCard } from '@/features/dashboard/components/activity-calendar-card'
import { OverflowTabHeader } from '@/features/navigation/components/overflow-tab-header'

// The data-nerd view: the dashboard cards' graphs at full width/range, one
// page-level language filter driving them all. Coverage has no cross-language
// merge (ranks are per-language), so "All" lists one coverage block per
// language while the activity chart sums the languages.
export const StatsView = () => {
  const { t, i18n } = useLingui()
  const { qualifying: coverageLanguages, unsupported, isLoading: isCoverageLoading } = useQualifyingCoverage()
  const { data: activity } = useActivity()
  const [selected, setSelected] = useState<string | null>(null)

  const languages = useMemo(
    () =>
      [
        ...new Set([
          ...coverageLanguages.map((entry) => entry.targetLanguage),
          ...(activity?.perLanguage.map((entry) => entry.targetLanguage) ?? []),
        ]),
      ].sort(),
    [coverageLanguages, activity]
  )
  const active = selected !== null && languages.includes(selected) ? selected : null

  const visibleCoverage = active
    ? coverageLanguages.filter((entry) => entry.targetLanguage === active)
    : coverageLanguages

  // When the filter (or the whole account) lands on languages without a
  // lemma_ranks build, "save a few terms first" would be a false promise —
  // no amount of saving produces a wall. Name the languages instead.
  const unsupportedForView = active ? unsupported.filter((entry) => entry.targetLanguage === active) : unsupported
  const unsupportedNames = unsupportedForView
    .map((entry) => getLocalizedCoverageLanguageName(i18n, entry.targetLanguage))
    .join(', ')

  return (
    <>
      <OverflowTabHeader backTo='/more' title={t`Stats`} />
      <PageContainer width='wide'>
        <h1 className='hidden text-2xl font-bold md:block'>{t`Stats`}</h1>

        {languages.length > 1 && (
          <div className='mt-4 flex flex-wrap gap-2'>
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

        {/* The charts respect the language filter; the streak calendar is
            user-level by definition and says so in its caption. */}
        <div className='grid items-stretch gap-x-4 lg:grid-cols-[1.6fr_1fr]'>
          <DailyActivityCharts language={active} />
          <ActivityCalendarCard variant='stats' />
        </div>

        <h2 className='mt-6 text-base font-semibold'>{t`Vocabulary coverage`}</h2>
        <div className='mt-2 flex flex-col gap-4'>
          {isCoverageLoading && <Skeleton className='h-64 w-full rounded-xl' />}
          {!isCoverageLoading && visibleCoverage.length === 0 && (
            <p className='text-muted-foreground text-sm'>
              {unsupportedForView.length > 0
                ? t`Vocabulary coverage isn't available for ${unsupportedNames} yet.`
                : t`No coverage data yet — save a few terms first.`}
            </p>
          )}
          {visibleCoverage.map((entry) => (
            <StatsCoverageBlock key={entry.targetLanguage} coverage={entry} />
          ))}
        </div>
      </PageContainer>
    </>
  )
}

const StatsCoverageBlock = ({ coverage }: { coverage: LanguageCoverage }) => {
  const { t, i18n } = useLingui()
  const states = useMemo(
    () => buildStateArray(coverage.denominator ?? 0, coverage.studiedRanks, coverage.knownRanks),
    [coverage]
  )
  const coveragePct = Math.round(coverage.coveragePct ?? 0)
  const studiedCount = coverage.studiedRanks.length.toLocaleString()
  const knownCount = coverage.knownRanks.length.toLocaleString()

  return (
    <div className='bg-card rounded-xl border p-4'>
      <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-2'>
        <div>
          <h3 className='font-semibold'>{getLocalizedCoverageLanguageName(i18n, coverage.targetLanguage)}</h3>
          <p className='text-muted-foreground text-sm tabular-nums'>
            {t`${studiedCount} studied · ${knownCount} marked known`}
          </p>
        </div>
        <div className='text-2xl font-bold tabular-nums'>
          ~{coveragePct}% <span className='text-muted-foreground text-sm font-semibold'>{t`of typical text`}</span>
        </div>
      </div>
      <Link
        to='/coverage/$lang'
        params={{ lang: coverage.targetLanguage }}
        aria-label={t`Open the full coverage view`}
        className='mt-3 block transition-opacity hover:opacity-90 active:opacity-75'
      >
        <CoverageDotGrid states={states} endRank={10000} cell={4} gap={1} compactRule={CARD_COMPACT_RULE} />
      </Link>
    </div>
  )
}
