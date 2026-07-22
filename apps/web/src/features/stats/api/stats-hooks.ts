import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import type { LanguageActivity } from '@flicktionary/api-client/orpc-contracts/stats-contract'

export type { LanguageActivity }

// Per-day activity + streak for the dashboard/stats charts. Passive dashboard
// data: never toast for it. Freshness rides on difficultyInvalidates()
// (practice-hooks.ts), which every knowledge-changing mutation already
// spreads — introductions, ratings and known marks are exactly this read's
// day-count sources.
export const useActivity = () => {
  return useQuery(
    orpcQuery.stats.getActivity.queryOptions({
      input: {},
      select: (response) => response.data,
      meta: { showErrorToast: false },
    })
  )
}
