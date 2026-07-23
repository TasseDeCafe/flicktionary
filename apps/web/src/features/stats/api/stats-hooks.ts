import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import type { LanguageActivity } from '@flicktionary/api-client/orpc-contracts/stats-contract'

export type { LanguageActivity }

// Per-day activity + streak for the dashboard/stats charts. Passive dashboard
// data: never toast for it. Freshness rides on difficultyInvalidates()
// (practice-hooks.ts), which every knowledge-changing mutation already
// spreads — introductions, ratings, exercise answers and known marks are
// exactly this read's day-count sources.
export const useActivity = () => {
  const queryClient = useQueryClient()
  const query = useQuery(
    orpcQuery.stats.getActivity.queryOptions({
      input: {},
      select: (response) => response.data,
      meta: { showErrorToast: false },
    })
  )

  // "Today" in the calendar is the response's last day (server UTC).
  // refetchOnWindowFocus refreshes a returning tab, but a tab left focused
  // across UTC midnight would keep rendering yesterday as today — so schedule
  // an invalidation at the next UTC midnight, rescheduled whenever a response
  // lands with a new server day.
  const serverToday = query.data?.days.at(-1)
  useEffect(() => {
    if (!serverToday) return
    const now = new Date()
    const nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    // A few seconds of slack so the refetch lands safely past the boundary.
    const delay = nextUtcMidnight - now.getTime() + 5_000
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: orpcQuery.stats.getActivity.key() })
    }, delay)
    return () => clearTimeout(timer)
  }, [serverToday, queryClient])

  return query
}
