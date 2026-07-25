import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'
import { maskConnectionString, resolveConnectionString } from './db-connection'
import { LOAD_LANGUAGES } from './kaikki-languages'

const VERIFIED_TABLES = ['wiktionary_entries', 'wiktionary_forms', 'wiktionary_form_redirects'] as const

// Every loaded language must have rows in all three wiktionary tables. A prod
// load once died silently mid-forms-COPY (the DB connection dropped, node's
// event loop drained, and the process exited 0), leaving wiktionary_forms
// empty while CI reported success — so this check runs both inside the loader
// and as a separate workflow step on a fresh connection.
export const verifyKaikkiLoad = async (sql: Sql, languages: readonly string[]): Promise<void> => {
  const failures: string[] = []
  for (const table of VERIFIED_TABLES) {
    const rows = await sql<{ target_language: string; count: number }[]>`
      SELECT target_language, COUNT(*)::int AS count
      FROM public.${sql(table)}
      GROUP BY target_language
    `
    const countByLanguage = new Map(rows.map((r) => [r.target_language, r.count]))
    for (const lang of languages) {
      const count = countByLanguage.get(lang) ?? 0
      console.log(`  ${table}.${lang}: ${count.toLocaleString()} rows`)
      if (count === 0) failures.push(`${table} has no rows for '${lang}'`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`kaikki load verification failed:\n  ${failures.join('\n  ')}`)
  }
}

const main = async (): Promise<void> => {
  const connectionString = resolveConnectionString()
  console.log(`Connecting to ${maskConnectionString(connectionString)}`)
  const sql = postgres(connectionString, { max: 1 })
  try {
    await verifyKaikkiLoad(sql, LOAD_LANGUAGES)
  } finally {
    await sql.end()
  }
  console.log('✓ Load verified.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error('FAILED:', err)
    process.exit(1)
  })
}
