import type { LanguageActivity } from '@flicktionary/api-client/orpc-contracts/stats-contract'
import type { StatsRepositoryInterface } from '../../transport/database/stats/stats-repository'
import type { AuthUsersRepository } from '../../transport/database/auth-users/auth-users-repository'

export type StatsDependencies = {
  statsRepository: StatsRepositoryInterface
  authUsersRepository: AuthUsersRepository
}

export type ActivityData = {
  days: string[]
  perLanguage: LanguageActivity[]
  streakDays: number
  activeDays: string[]
  joinedDay: string
}

// One fetch serves both surfaces: the dashboard calendar reads activeDays,
// the stats charts slice 14/30/90 days out of the full series window.
export const ACTIVITY_WINDOW_DAYS = 90

// 'YYYY-MM-DD' day arithmetic in UTC — the strings come from Postgres
// CURRENT_DATE and must round-trip without timezone drift.
const shiftDay = (day: string, deltaDays: number): string => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

// Oldest → newest, ending on `today`, windowDays entries.
export const buildDayWindow = (today: string, windowDays: number): string[] =>
  Array.from({ length: windowDays }, (_, i) => shiftDay(today, i - (windowDays - 1)))

// Consecutive active days ending today — or ending yesterday when today has no
// activity yet: a streak only breaks once the day is over, so an evening
// learner still sees their run intact in the morning.
export const computeStreakDays = (activeDays: readonly string[], today: string): number => {
  const active = new Set(activeDays)
  let cursor = active.has(today) ? today : shiftDay(today, -1)
  let streak = 0
  while (active.has(cursor)) {
    streak += 1
    cursor = shiftDay(cursor, -1)
  }
  return streak
}

export const getActivity = async (params: { userId: string }, deps: StatsDependencies): Promise<ActivityData> => {
  const [today, introduced, markedKnown, practiced, activeDays, joinedDayRaw] = await Promise.all([
    deps.statsRepository.getCurrentDay(),
    deps.statsRepository.countIntroducedByDay(params.userId, ACTIVITY_WINDOW_DAYS),
    deps.statsRepository.countMarkedKnownByDay(params.userId, ACTIVITY_WINDOW_DAYS),
    deps.statsRepository.countPracticedByDay(params.userId, ACTIVITY_WINDOW_DAYS),
    deps.statsRepository.listActiveDays(params.userId),
    deps.authUsersRepository.getJoinedDay(params.userId),
  ])

  const days = buildDayWindow(today, ACTIVITY_WINDOW_DAYS)
  const dayIndex = new Map(days.map((day, i) => [day, i]))

  const perLanguageMap = new Map<string, LanguageActivity>()
  const ensureLanguage = (targetLanguage: string): LanguageActivity => {
    const existing = perLanguageMap.get(targetLanguage)
    if (existing) return existing
    const entry: LanguageActivity = {
      targetLanguage,
      newTerms: days.map(() => 0),
      markedKnown: days.map(() => 0),
      practiced: days.map(() => 0),
    }
    perLanguageMap.set(targetLanguage, entry)
    return entry
  }

  for (const row of introduced) {
    const index = dayIndex.get(row.day)
    if (index === undefined) continue
    ensureLanguage(row.targetLanguage).newTerms[index] = row.count
  }
  for (const row of markedKnown) {
    const index = dayIndex.get(row.day)
    if (index === undefined) continue
    ensureLanguage(row.targetLanguage).markedKnown[index] = row.count
  }
  for (const row of practiced) {
    const index = dayIndex.get(row.day)
    if (index === undefined) continue
    ensureLanguage(row.targetLanguage).practiced[index] = row.count
  }

  const perLanguage = [...perLanguageMap.values()].sort((a, b) => a.targetLanguage.localeCompare(b.targetLanguage))
  return {
    days,
    perLanguage,
    streakDays: computeStreakDays(activeDays, today),
    activeDays,
    // A missing auth row can't really happen for an authenticated request;
    // falling back to today keeps the response total rather than failing it.
    joinedDay: joinedDayRaw ?? today,
  }
}
