import postgres from 'postgres'
import { shiftPracticeTimestamps } from '../src/transport/database/dev-tools/shift-practice-timestamps'

// Dev time travel: shift all practice timestamps backward so day-based guards
// (warm-up / leech-rehab graduation across 3 distinct days, the daily-new cap,
// excludeCreditedToday, srs_due) behave as if N days had passed. See
// shift-practice-timestamps.ts for why shifting data == advancing the clock.
//
// Usage (from the repo root or apps/backend):
//   pnpm db:advance-day                     # whole dev-tunnel DB, 1 day
//   pnpm db:advance-day --days 2            # 2 days
//   pnpm db:advance-day --email me@x.com    # only that user's data
//
// Hardcoded for local dev work, like load-kaikki.ts: the loader runs as a
// standalone tsx script without booting the app's config layer. Override with
// SUPABASE_CONNECTION_STRING (e.g. via `doppler run --`) if needed.
const DEFAULT_LOCAL_DEV_CONNECTION = 'postgresql://postgres:postgres@127.0.0.1:34322/postgres'

const parseArgs = (argv: string[]): { days: number; email?: string } => {
  let days = 1
  let email: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') {
      days = Number(argv[++i])
    } else if (argv[i] === '--email') {
      email = argv[++i]
    } else {
      throw new Error(`Unknown argument: ${argv[i]} (expected --days N and/or --email <email>)`)
    }
  }
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`--days must be a positive integer, got ${days}`)
  }
  return { days, email }
}

const main = async (): Promise<void> => {
  const { days, email } = parseArgs(process.argv.slice(2))
  const connectionString = process.env.SUPABASE_CONNECTION_STRING || DEFAULT_LOCAL_DEV_CONNECTION
  const sql = postgres(connectionString)

  try {
    let userId: string | undefined
    if (email) {
      const users = await sql<{ id: string }[]>`
        SELECT id FROM auth.users WHERE lower(email) = lower(${email})
      `
      if (users.length === 0) throw new Error(`No auth.users row found for email ${email}`)
      userId = users[0].id
      console.log(`Scoping to user ${email} (${userId})`)
    }

    const results = await shiftPracticeTimestamps(sql, { days, userId })

    console.log(`\nShifted practice data back by ${days} day(s)${email ? ` for ${email}` : ' for ALL users'}:`)
    for (const { table, columns, rowsShifted } of results) {
      console.log(`  ${table.padEnd(24)} ${String(rowsShifted).padStart(6)} rows  (${columns.join(', ')})`)
    }
    console.log('\nDone. Reload the app — "today" is now tomorrow as far as your practice data is concerned.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
