import type postgres from 'postgres'

// Dev-only time travel for the practice system. Every "what day is it" rule
// lives in Postgres as a comparison between a stored timestamp and the real
// NOW() / CURRENT_DATE (rehab day credits, the daily-new cap window,
// excludeCreditedToday, srs_due due-ness). So instead of faking the clock —
// which Postgres does not allow — we shift the DATA backward: subtracting one
// day from every time column of the practice tables is exactly equivalent to
// the server clock advancing one day. This lets multi-day flows (warm-up /
// leech-rehab graduation needs correct answers on 3 distinct calendar days) be
// exercised end-to-end in one sitting, with real data and the real code paths.
//
// Columns are discovered from information_schema (all timestamptz / timestamp
// / date columns of the listed tables), so new time columns are picked up
// automatically and this module never needs a column list kept in sync.

// The practice-time closure: SRS facets + the rating audit log (its prev_srs_*
// snapshots must move too, or an undo after a shift would restore a schedule
// from the "future"), the exercise bank, reading texts, and user_lookups
// (recently-added ordering only, shifted for consistency). Every table carries
// its own user_id column.
const SHIFT_TABLES = ['study_facets', 'user_lookups', 'practice_rating_events', 'practice_exercises', 'practice_texts']

const TIME_COLUMN_TYPES = ['timestamp with time zone', 'timestamp without time zone', 'date']

export type ShiftedTable = { table: string; columns: string[]; rowsShifted: number }

export type ShiftPracticeTimestampsParams = {
  days: number
  // When set, only this user's rows shift. Omit to shift the whole database
  // (the standalone dev-tunnel script's default).
  userId?: string
}

export const shiftPracticeTimestamps = (
  sql: postgres.Sql,
  params: ShiftPracticeTimestampsParams
): Promise<ShiftedTable[]> => {
  const { days, userId } = params
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`days must be a positive integer, got ${days}`)
  }

  // One transaction so a failure can't leave the tables shifted by different
  // amounts. Same TransactionSql cast as beginTx in postgres-client.ts.
  return sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as postgres.Sql
    const results: ShiftedTable[] = []

    for (const table of SHIFT_TABLES) {
      const columns = await tx<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${table}
          AND data_type = ANY(${TIME_COLUMN_TYPES})
        ORDER BY ordinal_position
      `
      // Every listed table has time columns today; zero matches means the
      // table was dropped or renamed and this list needs updating.
      if (columns.length === 0) {
        throw new Error(`shiftPracticeTimestamps: no time columns found for table "${table}" — was it dropped/renamed?`)
      }

      // `date - int` subtracts days and stays a date; `timestamp - interval`
      // keeps the time of day, so relative day boundaries are preserved.
      const setClause = columns
        .map((col) =>
          col.data_type === 'date'
            ? tx`${tx(col.column_name)} = ${tx(col.column_name)} - ${days}::int`
            : tx`${tx(col.column_name)} = ${tx(col.column_name)} - make_interval(days => ${days})`
        )
        .reduce((acc, fragment) => tx`${acc}, ${fragment}`)

      const whereClause = userId === undefined ? tx`TRUE` : tx`user_id = ${userId}`

      const updated = await tx`UPDATE ${tx(table)} SET ${setClause} WHERE ${whereClause}`

      results.push({
        table,
        columns: columns.map((col) => col.column_name),
        rowsShifted: updated.count,
      })
    }

    return results
  }) as Promise<ShiftedTable[]>
}
