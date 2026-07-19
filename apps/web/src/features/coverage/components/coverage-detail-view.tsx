import { useEffect, useMemo, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { FullViewLoader } from '@flicktionary/ui/components/full-view-loader'
import { Button } from '@flicktionary/ui/components/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useCoverage, useCoverageTopLemmas, type LanguageCoverage } from '../api/coverage-hooks'
import { buildStateArray, STATE_KNOWN, STATE_STUDIED } from '../utils/coverage-render'
import { CoverageDotGrid, CoverageSkyline, type DotHover } from './coverage-canvas'
import { CoverageLegend } from './coverage-legend'
import { getLocalizedCoverageLanguageName } from '../utils/coverage-language-names'

const routeApi = getRouteApi('/_authenticated/_app/coverage/$lang')

// Per-band waffle metrics: the head gets bigger cells (those lemmas matter
// more), the tail packs tight.
const BAND_CELLS = [
  { cell: 8, gap: 2 },
  { cell: 6, gap: 2 },
  { cell: 4, gap: 1 },
  { cell: 3, gap: 1 },
]

const TOOLTIP_LEMMA_LIMIT = 5000

// The full coverage view behind the dashboard card: the pixel wall (with a
// top-10k / full-denominator toggle and lemma tooltips), the frequency-band
// waffles, and the aggregated skyline — all renderings of one cached
// getCoverage response.
export const CoverageDetailView = () => {
  const { t, i18n } = useLingui()
  const navigate = useNavigate()
  const { lang } = routeApi.useParams()
  const { data: languages, isLoading, isError, isFetching, refetch } = useCoverage()

  const entry = languages?.find((language) => language.targetLanguage === lang)
  const usable = entry !== undefined && entry.supported && entry.denominator !== null

  // A stale or unsupported deep link falls back to the sessions list instead
  // of rendering an empty shell.
  useEffect(() => {
    if (!isLoading && !isError && languages && !usable) void navigate({ to: '/sessions', replace: true })
  }, [isLoading, isError, languages, usable, navigate])

  const close = () => void navigate({ to: '/sessions' })
  const languageName = getLocalizedCoverageLanguageName(i18n, lang)

  return (
    <ModalScreen onClose={close} closeIcon='chevron' title={t`${languageName} vocabulary`}>
      {isLoading ? (
        <FullViewLoader />
      ) : isError ? (
        <CoverageDetailError isRetrying={isFetching} onRetry={() => void refetch()} />
      ) : !usable ? (
        <FullViewLoader />
      ) : (
        <CoverageDetailBody coverage={entry} />
      )}
    </ModalScreen>
  )
}

const CoverageDetailError = ({ isRetrying, onRetry }: { isRetrying: boolean; onRetry: () => void }) => {
  const { t } = useLingui()
  return (
    <div className='flex flex-1 items-center justify-center px-4 py-8'>
      <div className='flex max-w-sm flex-col items-center gap-3 text-center'>
        <p className='text-muted-foreground text-sm'>{t`We couldn't load your vocabulary coverage.`}</p>
        <Button type='button' variant='outline' size='sm' onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? t`Trying again…` : t`Try again`}
        </Button>
      </div>
    </div>
  )
}

const CoverageDetailBody = ({ coverage }: { coverage: LanguageCoverage }) => {
  const { t } = useLingui()
  const denominator = coverage.denominator ?? 0
  const [showAll, setShowAll] = useState(false)
  const [hover, setHover] = useState<DotHover | null>(null)

  const states = useMemo(
    () => buildStateArray(denominator, coverage.studiedRanks, coverage.knownRanks),
    [denominator, coverage]
  )

  const { data: topLemmas } = useCoverageTopLemmas(coverage.targetLanguage, coverage.buildVersion, true)
  // Never pair lemma labels with ranks from a different lemma_ranks build —
  // a rebuild reorders ranks, and a mislabeled dot is worse than a bare one.
  const lemmaLabels = topLemmas?.buildVersion === coverage.buildVersion ? topLemmas.lemmas : undefined

  // The tooltip is anchored to a fixed position; scrolling moves the dot away
  // from under it, so it hides rather than drifts.
  useEffect(() => {
    if (!hover) return
    const hide = () => setHover(null)
    window.addEventListener('scroll', hide, { passive: true, capture: true })
    return () => window.removeEventListener('scroll', hide, { capture: true })
  }, [hover])

  const coveragePct = Math.round(coverage.coveragePct ?? 0)
  const verifiedPct = Math.round(coverage.verifiedPct ?? 0)
  const format = (value: number) => value.toLocaleString()
  const topRangeLabel = format(10000)
  const denominatorLabel = format(denominator)
  const wallEndRank = showAll ? denominator : Math.min(10000, denominator)

  return (
    <div className='flex-1 overflow-y-auto'>
      <div className='mx-auto w-full max-w-4xl px-4 py-4'>
        <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
          <span className='text-3xl font-bold tabular-nums'>~{coveragePct}%</span>
          <span className='text-muted-foreground text-sm'>{t`of typical text`}</span>
          <span className='text-muted-foreground text-sm tabular-nums'>{t`${verifiedPct}% verified · rest claimed`}</span>
        </div>
        <p className='text-muted-foreground mt-1 text-sm'>
          {t`One dot per word, ordered by frequency — the most common words sit top-left. This measures vocabulary only.`}
        </p>

        {denominator > 10000 && (
          <div className='mt-4 inline-flex overflow-hidden rounded-lg border'>
            <RangeToggleButton active={!showAll} onClick={() => setShowAll(false)}>
              {t`Top ${topRangeLabel}`}
            </RangeToggleButton>
            <RangeToggleButton active={showAll} onClick={() => setShowAll(true)}>
              {t`All ${denominatorLabel}`}
            </RangeToggleButton>
          </div>
        )}

        <div className='mt-3'>
          <CoverageDotGrid states={states} endRank={wallEndRank} cell={showAll ? 3 : 4} gap={1} onDotHover={setHover} />
        </div>
        <CoverageLegend
          studiedCount={coverage.studiedRanks.length}
          knownCount={coverage.knownRanks.length}
          notYetCount={denominator - coverage.studiedRanks.length - coverage.knownRanks.length}
          mweCount={coverage.mweCount ?? 0}
        />

        <h2 className='mt-8 font-semibold'>{t`By frequency band`}</h2>
        <div className='mt-3 flex flex-col gap-5'>
          {coverage.bands.map((band, index) => {
            const from = band.fromRank
            const to = Math.min(band.toRank ?? denominator, denominator)
            if (from > denominator) return null
            const bandPct = Math.round(band.coveragePct)
            const metrics = BAND_CELLS[Math.min(index, BAND_CELLS.length - 1)]
            const toLabel = format(to)
            return (
              <div key={from}>
                <div className='flex items-baseline justify-between text-sm tabular-nums'>
                  <span className='font-medium'>
                    {band.toRank === null
                      ? `${format(from)}+`
                      : from === 1
                        ? t`Top ${toLabel}`
                        : `${format(from)} – ${toLabel}`}
                  </span>
                  <span className='text-muted-foreground'>{t`${bandPct}% of this band's text share`}</span>
                </div>
                <div className='mt-1.5'>
                  <CoverageDotGrid
                    states={states}
                    startRank={from}
                    endRank={to}
                    cell={metrics.cell}
                    gap={metrics.gap}
                    onDotHover={setHover}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <h2 className='mt-8 font-semibold'>{t`At a glance`}</h2>
        <p className='text-muted-foreground mt-1 text-sm'>
          {t`Each column is 100 words; the filled share is how many of them you know.`}
        </p>
        <div className='mt-3'>
          <CoverageSkyline states={states} />
        </div>

        {hover && <DotTooltip hover={hover} states={states} lemmaLabels={lemmaLabels} />}
      </div>
    </div>
  )
}

const RangeToggleButton = ({
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
    className={`px-3 py-1 text-sm font-medium transition-colors ${
      active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent active:bg-accent/80'
    }`}
  >
    {children}
  </button>
)

const DotTooltip = ({
  hover,
  states,
  lemmaLabels,
}: {
  hover: DotHover
  states: Uint8Array
  lemmaLabels: string[] | undefined
}) => {
  const { t } = useLingui()
  const state = states[hover.rank - 1]
  const stateLabel = state === STATE_STUDIED ? t`studied` : state === STATE_KNOWN ? t`marked known` : t`not yet known`
  const lemma = hover.rank <= TOOLTIP_LEMMA_LIMIT ? lemmaLabels?.[hover.rank - 1] : undefined
  const rankLabel = hover.rank.toLocaleString()

  // Clamp near the right edge so the tooltip never forces horizontal scroll.
  const flip = hover.clientX > window.innerWidth - 180
  return (
    <div
      className='bg-foreground text-background pointer-events-none fixed z-50 max-w-56 rounded-md px-2.5 py-1.5 text-xs tabular-nums'
      style={{
        left: flip ? undefined : hover.clientX + 12,
        right: flip ? window.innerWidth - hover.clientX + 12 : undefined,
        top: hover.clientY + 14,
      }}
    >
      {lemma !== undefined && <span className='font-bold'>{lemma} · </span>}
      {t`rank ${rankLabel}`} · {stateLabel}
    </div>
  )
}
