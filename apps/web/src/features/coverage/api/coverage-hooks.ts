import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import type { LanguageCoverage } from '@flicktionary/api-client/orpc-contracts/coverage-contract'

export type { LanguageCoverage }

// One batched read for every practiced language — the dashboard card's chips
// and the /coverage/$lang detail view share this cached response. Passive
// dashboard data: never toast for it. Freshness rides on
// difficultyInvalidates() (practice-hooks.ts), which every knowledge-changing
// mutation already spreads.
export const useCoverage = () => {
  return useQuery(
    orpcQuery.coverage.getCoverage.queryOptions({
      input: {},
      select: (response) => response.data.languages,
      meta: { showErrorToast: false },
    })
  )
}

// Splits the practiced languages by what the coverage UI can draw.
// `qualifying` = supported (a lemma_ranks build exists) AND non-empty — an
// all-gray wall for a brand-new user is demotivating, and the getting-started
// checklist owns that moment. `unsupported` = practiced languages that will
// never produce a wall no matter how many terms get saved; the stats view
// uses it for an honest empty state. The dashboard and the coverage card must
// share this filter: the dashboard decides whether the carousel gets a
// coverage slide at all, and a disagreement renders as a blank slide.
export const useQualifyingCoverage = () => {
  const { data: languages, isLoading } = useCoverage()
  const qualifying = useMemo(
    () =>
      (languages ?? []).filter(
        (language) => language.supported && language.studiedRanks.length + language.knownRanks.length > 0
      ),
    [languages]
  )
  const unsupported = useMemo(() => (languages ?? []).filter((language) => !language.supported), [languages])
  return { qualifying, unsupported, isLoading }
}

const TOP_LEMMAS_STALE_MS = 24 * 60 * 60 * 1000

// The top-5k lemma strings behind the detail view's dot tooltips. Static per
// lemma_ranks build, hence the long staleTime; the response carries its
// buildVersion and the consumer must refuse to pair labels with coverage
// ranks from a different build (a rank rebuild would otherwise mislabel dots
// until the cache expires).
export const useCoverageTopLemmas = (targetLanguage: string | null, buildVersion: number | null, enabled: boolean) => {
  return useQuery(
    orpcQuery.coverage.getTopLemmas.queryOptions({
      // buildVersion belongs in the input so a newly published rank build gets
      // a fresh query key instead of inheriting the previous build's 24-hour
      // cache entry.
      input: { targetLanguage: targetLanguage ?? '', buildVersion: buildVersion ?? 0 },
      enabled: enabled && !!targetLanguage && buildVersion !== null,
      select: (response) => response.data,
      staleTime: TOP_LEMMAS_STALE_MS,
      meta: { showErrorToast: false },
    })
  )
}
