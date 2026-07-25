import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { SeeMoreLink } from '@/components/ui/see-more-link'
import { FilterChip } from '@/components/filter-chip'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { useQualifyingCoverage, type LanguageCoverage } from '../api/coverage-hooks'
import { buildStateArray, CARD_COMPACT_RULE } from '../utils/coverage-render'
import { CoverageDotGrid } from './coverage-canvas'
import { CoverageLegend } from './coverage-legend'
import { getLocalizedCoverageLanguageName } from '../utils/coverage-language-names'

// The dashboard card always shows the top 5,000 lemmas — the full wall lives
// in the stats and per-language coverage views. Capping it here keeps the two
// dashboard cards near the same height and keeps the header's "Top N words"
// claim honest at every container width.
const CARD_END_RANK = 5000

// The dashboard coverage card: ONE card showing the last-used practiced
// language with chips to flip between them. Only qualifying languages (see
// useQualifyingCoverage) are shown; the card appears from the first saved
// word. The dashboard uses the same hook to keep this card out of the
// carousel entirely when nothing qualifies — the null return here is only a
// safety net. On mobile the card chrome drops so the wall spans the same
// width as the session cards below.
export const CoverageCard = () => {
  const { t, i18n } = useLingui()
  const { qualifying, isLoading } = useQualifyingCoverage()
  const { data: prefs } = useGetUserPrefs()
  const [selected, setSelected] = useState<string | null>(null)

  const active =
    qualifying.find((language) => language.targetLanguage === selected) ??
    qualifying.find((language) => language.targetLanguage === prefs?.lastTargetLanguage) ??
    qualifying[0]

  if (isLoading) return <CoverageCardSkeleton />
  if (!active) return null

  const wallSize = Math.min(CARD_END_RANK, active.denominator ?? 0)
  // The legend must describe what the wall actually shows, so its counts are
  // scoped to the wall's rank range — totals live in the stats view.
  const studiedInWall = active.studiedRanks.filter((rank) => rank <= wallSize).length
  const knownInWall = active.knownRanks.filter((rank) => rank <= wallSize).length

  const chips = qualifying.length > 1 ? qualifying.map((language) => language.targetLanguage) : []

  return (
    <div className='md:bg-card mt-4 flex flex-col md:h-full md:rounded-xl md:border md:p-4'>
      <CoverageCardHeader coverage={active} wallSize={wallSize} />
      <Link
        to='/coverage/$lang'
        params={{ lang: active.targetLanguage }}
        aria-label={t`Open the full coverage view`}
        className='mt-3 block transition-opacity hover:opacity-90 active:opacity-75'
      >
        <CoverageWall coverage={active} />
      </Link>
      {/* "More stats" gets its own line so the card height doesn't depend on
          how wide the legend counts are — sharing a wrap row made the chips
          jump when switching languages changed the numbers. */}
      <CoverageLegend studiedCount={studiedInWall} knownCount={knownInWall} className='mt-3' />
      <SeeMoreLink to='/stats' className='mt-2 self-start'>{t`More stats`}</SeeMoreLink>
      {chips.length > 0 && (
        <div className='mt-auto flex flex-wrap justify-center gap-2 pt-3'>
          {chips.map((language) => (
            <FilterChip
              key={language}
              active={language === active.targetLanguage}
              onClick={() => setSelected(language)}
            >
              {getLocalizedCoverageLanguageName(i18n, language)}
            </FilterChip>
          ))}
        </div>
      )}
    </div>
  )
}

const CoverageCardHeader = ({ coverage, wallSize }: { coverage: LanguageCoverage; wallSize: number }) => {
  const { t } = useLingui()
  const coveragePct = Math.round(coverage.coveragePct ?? 0)
  const wallSizeLabel = wallSize.toLocaleString()
  return (
    <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-2'>
      <div>
        <h2 className='font-semibold'>{t`Vocabulary coverage`}</h2>
        <p className='text-muted-foreground text-sm tabular-nums'>{t`Top ${wallSizeLabel} words`}</p>
      </div>
      <div className='text-right'>
        <div className='text-2xl font-bold tabular-nums'>~{coveragePct}%</div>
        <div className='text-muted-foreground text-xs'>{t`of typical text`}</div>
      </div>
    </div>
  )
}

const CoverageWall = ({ coverage }: { coverage: LanguageCoverage }) => {
  const states = useMemo(
    () => buildStateArray(coverage.denominator ?? 0, coverage.studiedRanks, coverage.knownRanks),
    [coverage]
  )
  return <CoverageDotGrid states={states} endRank={CARD_END_RANK} cell={4} gap={1} compactRule={CARD_COMPACT_RULE} />
}

// Sized to the desktop card (header + top-5k wall + legend) so data landing
// doesn't shift the session list below.
const CoverageCardSkeleton = () => (
  <div className='md:bg-card mt-4 flex flex-col md:rounded-xl md:border md:p-4'>
    <div className='flex items-start justify-between'>
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-5 w-40' />
        <Skeleton className='h-4 w-32' />
      </div>
      <Skeleton className='h-8 w-24' />
    </div>
    <Skeleton className='mt-3 h-48 w-full' />
    <Skeleton className='mt-3 h-4 w-64' />
    <Skeleton className='mt-2 h-4 w-24' />
  </div>
)
