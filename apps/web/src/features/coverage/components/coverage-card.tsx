import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { SeeMoreLink } from '@/components/ui/see-more-link'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { useCoverage, type LanguageCoverage } from '../api/coverage-hooks'
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
// language with chips to flip between them. Languages are shown only when
// supported (a lemma_rank_builds row exists) AND non-empty — an all-gray wall
// for a brand-new user is demotivating, and the checklist owns that moment;
// the card appears from the first saved word. On mobile the card chrome
// drops so the wall spans the same width as the session cards below.
export const CoverageCard = () => {
  const { t } = useLingui()
  const { data: languages, isLoading } = useCoverage()
  const { data: prefs } = useGetUserPrefs()
  const [selected, setSelected] = useState<string | null>(null)

  const qualifying = useMemo(
    () =>
      (languages ?? []).filter(
        (language) => language.supported && language.studiedRanks.length + language.knownRanks.length > 0
      ),
    [languages]
  )

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
      <div className='mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2'>
        <CoverageLegend studiedCount={studiedInWall} knownCount={knownInWall} />
        <SeeMoreLink to='/stats'>{t`More stats`}</SeeMoreLink>
      </div>
      {chips.length > 0 && (
        <div className='mt-auto flex flex-wrap justify-center gap-2 pt-3'>
          {chips.map((language) => (
            <CoverageChip
              key={language}
              language={language}
              active={language === active.targetLanguage}
              onSelect={setSelected}
            />
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

const CoverageChip = ({
  language,
  active,
  onSelect,
}: {
  language: string
  active: boolean
  onSelect: (language: string) => void
}) => {
  const { i18n } = useLingui()
  return (
    <button
      type='button'
      onClick={() => onSelect(language)}
      className={`shrink-0 rounded-full px-3 py-1 text-sm whitespace-nowrap transition-colors ${
        active
          ? 'bg-yellow-400 font-medium text-yellow-950'
          : 'bg-muted text-foreground hover:bg-accent active:bg-accent/80'
      }`}
    >
      {getLocalizedCoverageLanguageName(i18n, language)}
    </button>
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
  </div>
)
