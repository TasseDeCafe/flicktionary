import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { useCoverage, type LanguageCoverage } from '../api/coverage-hooks'
import { buildStateArray, CARD_COMPACT_RULE } from '../utils/coverage-render'
import { CoverageDotGrid } from './coverage-canvas'
import { CoverageLegend } from './coverage-legend'
import { getLocalizedCoverageLanguageName } from '../utils/coverage-language-names'

// The sessions-page coverage card (the dashboard's second tenant, after
// GettingStartedChecklist): ONE card showing the last-used practiced language
// with chips to flip between them. Languages are shown only when supported
// (a lemma_rank_builds row exists) AND non-empty — an all-gray wall for a
// brand-new user is demotivating, and the checklist owns that moment; the
// card appears from the first saved word.
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

  return (
    <div className='bg-card mt-4 rounded-xl border p-4'>
      <CoverageCardHeader
        coverage={active}
        chips={qualifying.length > 1 ? qualifying.map((language) => language.targetLanguage) : []}
        onSelect={setSelected}
      />
      <Link
        to='/coverage/$lang'
        params={{ lang: active.targetLanguage }}
        aria-label={t`Open the full coverage view`}
        className='mt-3 block transition-opacity hover:opacity-90 active:opacity-75'
      >
        <CoverageWall coverage={active} />
      </Link>
      <CoverageLegend
        studiedCount={active.studiedRanks.length}
        knownCount={active.knownRanks.length}
        notYetCount={(active.denominator ?? 0) - active.studiedRanks.length - active.knownRanks.length}
        mweCount={active.mweCount ?? 0}
      />
    </div>
  )
}

const CoverageCardHeader = ({
  coverage,
  chips,
  onSelect,
}: {
  coverage: LanguageCoverage
  chips: string[]
  onSelect: (language: string) => void
}) => {
  const { t, i18n } = useLingui()
  const coveragePct = Math.round(coverage.coveragePct ?? 0)
  const verifiedPct = Math.round(coverage.verifiedPct ?? 0)
  const studiedCount = coverage.studiedRanks.length.toLocaleString()
  const knownCount = coverage.knownRanks.length.toLocaleString()
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-2'>
        <div>
          <h2 className='font-semibold'>{t`Vocabulary coverage`}</h2>
          <p className='text-muted-foreground text-sm tabular-nums'>
            {t`${studiedCount} studied · ${knownCount} marked known`}
          </p>
        </div>
        <div className='text-right'>
          <div className='text-2xl font-bold tabular-nums'>
            ~{coveragePct}% <span className='text-muted-foreground text-sm font-semibold'>{t`of typical text`}</span>
          </div>
          <div className='text-muted-foreground text-xs tabular-nums'>{t`${verifiedPct}% verified · rest claimed`}</div>
        </div>
      </div>
      {chips.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {chips.map((language) => (
            <button
              key={language}
              type='button'
              onClick={() => onSelect(language)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm whitespace-nowrap transition-colors ${
                language === coverage.targetLanguage
                  ? 'bg-yellow-400 font-medium text-yellow-950'
                  : 'bg-muted text-foreground hover:bg-accent active:bg-accent/80'
              }`}
            >
              {getLocalizedCoverageLanguageName(i18n, language)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const CoverageWall = ({ coverage }: { coverage: LanguageCoverage }) => {
  const states = useMemo(
    () => buildStateArray(coverage.denominator ?? 0, coverage.studiedRanks, coverage.knownRanks),
    [coverage]
  )
  return <CoverageDotGrid states={states} endRank={10000} cell={4} gap={1} compactRule={CARD_COMPACT_RULE} />
}

// Sized to the desktop card (header + top-10k wall + legend) so data landing
// doesn't shift the session list below.
const CoverageCardSkeleton = () => (
  <div className='bg-card mt-4 rounded-xl border p-4'>
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
