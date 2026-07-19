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
