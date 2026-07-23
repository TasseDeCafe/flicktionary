import { sql } from '../postgres-client'

export type DailyLanguageCount = { day: string; targetLanguage: string; count: number }

// Cross-table per-day activity reads for the stats surface. All day math is
// Postgres CURRENT_DATE (server UTC day) — the same boundary the practice
// budgets use — so these numbers agree with the daily-new counters and with
// `pnpm db:advance-day` time travel. Days come back as 'YYYY-MM-DD' strings.

// Terms introduced per day per language. `introduced_at` is stamped by the
// introduction claim for both pools' citation facets and each facet consumes
// one daily-new slot, so COUNT(*) matches the budget's own arithmetic.
const countIntroducedByDay = async (userId: string, windowDays: number): Promise<DailyLanguageCount[]> => {
  const rows = (await sql`
    SELECT introduced_at::date::text AS day, target_language, COUNT(*)::int AS count
    FROM public.study_facets
    WHERE user_id = ${userId}
      AND introduced_at >= CURRENT_DATE - ${windowDays - 1}::int
    GROUP BY 1, 2
  `) as Array<{ day: string; target_language: string; count: number }>
  return rows.map((r) => ({ day: r.day, targetLanguage: r.target_language, count: r.count }))
}

// Lemmas marked known per day per language. Includes sweep bulk-marks — a
// "mark remaining known" press is a genuine (and honestly spiky) activity.
const countMarkedKnownByDay = async (userId: string, windowDays: number): Promise<DailyLanguageCount[]> => {
  const rows = (await sql`
    SELECT marked_at::date::text AS day, target_language, COUNT(*)::int AS count
    FROM public.known_lemmas
    WHERE user_id = ${userId}
      AND marked_at >= CURRENT_DATE - ${windowDays - 1}::int
    GROUP BY 1, 2
  `) as Array<{ day: string; target_language: string; count: number }>
  return rows.map((r) => ({ day: r.day, targetLanguage: r.target_language, count: r.count }))
}

// Practice interactions per day per language: live ratings + answered
// exercises. Introductions are counted here AND in countIntroducedByDay on
// purpose — new terms arrive via gate exercises as well as intro ratings, and
// exercises carry no introduction-origin column, so a rating-side filter would
// be inconsistent; the two series render as separate charts, never a stack.
// Checkpoint provenance: the two lanes share checkpoint_id, discriminated by
// was_explicit. Implicit bulk reading credits (was_explicit = false) are
// excluded — they'd re-import the marked-known spikiness this chart exists to
// avoid — while deliberate per-term "I know this" assertions count. Both lanes
// remain streak-qualifying via listActiveDays below.
const countPracticedByDay = async (userId: string, windowDays: number): Promise<DailyLanguageCount[]> => {
  const rows = (await sql`
    SELECT day::text AS day, target_language, COUNT(*)::int AS count
    FROM (
      SELECT rated_at::date AS day, target_language
      FROM public.practice_rating_events
      WHERE user_id = ${userId}
        AND rated_at >= CURRENT_DATE - ${windowDays - 1}::int
        AND reverted_at IS NULL
        AND import_batch_id IS NULL
        AND NOT (checkpoint_id IS NOT NULL AND was_explicit = false)
      UNION ALL
      SELECT used_at::date, target_language
      FROM public.practice_exercises
      WHERE user_id = ${userId}
        AND used_at >= CURRENT_DATE - ${windowDays - 1}::int
    ) AS events
    GROUP BY 1, 2
  `) as Array<{ day: string; target_language: string; count: number }>
  return rows.map((r) => ({ day: r.day, targetLanguage: r.target_language, count: r.count }))
}

// Every calendar day with any streak-qualifying activity, newest first,
// unbounded (a cap would silently break long streaks). Rating events exclude
// undone ratings and lesson-import backfills; checkpoint reading credits are
// rating events too, so reading counts. Session opens deliberately don't.
const listActiveDays = async (userId: string): Promise<string[]> => {
  const rows = (await sql`
    SELECT day::text AS day FROM (
      SELECT DISTINCT introduced_at::date AS day
      FROM public.study_facets
      WHERE user_id = ${userId} AND introduced_at IS NOT NULL
      UNION
      SELECT DISTINCT rated_at::date
      FROM public.practice_rating_events
      WHERE user_id = ${userId} AND reverted_at IS NULL AND import_batch_id IS NULL
      UNION
      SELECT DISTINCT used_at::date
      FROM public.practice_exercises
      WHERE user_id = ${userId} AND used_at IS NOT NULL
      UNION
      SELECT DISTINCT marked_at::date
      FROM public.known_lemmas
      WHERE user_id = ${userId}
    ) AS d
    ORDER BY day DESC
  `) as Array<{ day: string }>
  return rows.map((r) => r.day)
}

// The server's current calendar day — fetched from Postgres, never computed in
// Node, so the streak/window anchor matches the queries above under time
// travel and across timezones.
const getCurrentDay = async (): Promise<string> => {
  const rows = (await sql`SELECT CURRENT_DATE::text AS today`) as Array<{ today: string }>
  return rows[0].today
}

export const StatsRepository = () => ({
  countIntroducedByDay,
  countMarkedKnownByDay,
  countPracticedByDay,
  listActiveDays,
  getCurrentDay,
})

export type StatsRepositoryInterface = ReturnType<typeof StatsRepository>
