import { readFileSync, writeFileSync } from 'node:fs'
import postgres from 'postgres'
import { maskConnectionString, resolveConnectionString } from './db-connection'
import type { HeadwordGroup, PlannedCluster, SenseRow } from '../src/service/user-lookups/plan-sense-merges'

// One-time cleanup of vocabulary rows split by sense label: before save-time
// sense dedup, every save labeled the sense afresh, so re-saving a word could
// create a second row ("revolt, uprising" / "uprising, revolt") that splits
// its practice and demand signals. Re-runnable as a sweeper (the same race can
// still split two concurrent saves).
//
// Two steps, so the LLM's judgments are reviewed before anything is written:
//   --plan <file>   find candidate groups (same user, language, headword),
//                   cluster same-meaning senses with senseMatchPass, write the
//                   clusters to <file>. Reads only.
//   --apply <file>  merge each cluster in the (hand-editable) plan, one
//                   transaction per cluster; clusters edited since planning
//                   are skipped.
//
// Usage (from apps/backend; NODE_ENV picks the app config for the Anthropic key):
//   NODE_ENV=production doppler run --config prd -- npx tsx scripts/merge-duplicate-senses.ts --plan plan.json
//   NODE_ENV=production doppler run --config prd -- npx tsx scripts/merge-duplicate-senses.ts --apply plan.json

const argValue = (flag: string): string | null => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? null : (process.argv[index + 1] ?? null)
}

type CandidateRow = {
  user_id: string
  target_language: string
  folded: string
  id: string
  headword: string
  sense: string
  definition: string | null
  translation: string | null
  target_example: string | null
}

const loadGroups = async (sql: postgres.Sql): Promise<HeadwordGroup[]> => {
  const rows = (await sql`
    WITH live AS (
      SELECT ul.*, LOWER(ul.headword) AS folded
      FROM public.user_lookups ul
      WHERE ul.deleted_at IS NULL AND ul.sense <> ''
    )
    SELECT user_id, target_language, folded, id, headword, sense, definition, translation, target_example
    FROM live l
    WHERE EXISTS (
      SELECT 1 FROM live o
      WHERE o.user_id = l.user_id AND o.target_language = l.target_language
        AND o.folded = l.folded AND o.id <> l.id
    )
    ORDER BY user_id, target_language, folded, created_at, id
  `) as unknown as CandidateRow[]

  const groups = new Map<string, HeadwordGroup>()
  for (const row of rows) {
    const key = `${row.user_id}|${row.target_language}|${row.folded}`
    const group = groups.get(key) ?? { userId: row.user_id, targetLanguage: row.target_language, rows: [] }
    const senseRow: SenseRow = {
      id: row.id,
      headword: row.headword,
      sense: row.sense,
      definition: row.definition,
      translation: row.translation,
      targetExample: row.target_example,
    }
    group.rows.push(senseRow)
    groups.set(key, group)
  }
  return [...groups.values()]
}

const plan = async (sql: postgres.Sql, outFile: string): Promise<void> => {
  // The app config (Anthropic key) is chosen from NODE_ENV; import it only
  // in the step that calls the model.
  const { AnthropicPasses } = await import('../src/transport/third-party/anthropic/anthropic-passes')
  const { planSenseMerges } = await import('../src/service/user-lookups/plan-sense-merges')
  const anthropicPasses = AnthropicPasses()

  const groups = await loadGroups(sql)
  console.log(`${groups.length} headword groups with 2+ saved senses`)
  const clusters: PlannedCluster[] = []
  let failures = 0
  for (const [index, group] of groups.entries()) {
    clusters.push(
      ...(await planSenseMerges(group, {
        anthropicPasses,
        onError: (error) => {
          failures += 1
          const message = error instanceof Error ? error.message : String(error)
          console.error(`  senseMatchPass failed for "${group.rows[0]!.headword}": ${message}`)
        },
      }))
    )
    if ((index + 1) % 25 === 0) console.log(`  ${index + 1}/${groups.length} groups planned`)
  }

  for (const cluster of clusters) {
    console.log(`${cluster.rows[0]!.headword}: ${cluster.rows.map((r) => r.sense).join(' | ')}`)
  }
  const rowsMerged = clusters.reduce((n, c) => n + c.rows.length - 1, 0)
  console.log(`${clusters.length} clusters, ${rowsMerged} rows to fold in, ${failures} pass failures`)
  writeFileSync(outFile, JSON.stringify(clusters, null, 2))
  console.log(`Plan written to ${outFile} — review it (drop clusters you disagree with), then --apply it.`)
}

const apply = async (sql: postgres.Sql, planFile: string): Promise<void> => {
  const { mergeUserLookups } = await import('../src/transport/database/user-lookups/merge-user-lookups')
  const clusters = JSON.parse(readFileSync(planFile, 'utf8')) as PlannedCluster[]
  let merged = 0
  for (const cluster of clusters) {
    const outcome = await mergeUserLookups({ userId: cluster.userId, rows: cluster.rows }, sql)
    const label = `${cluster.rows[0]!.headword}: ${cluster.rows.map((r) => r.sense).join(' | ')}`
    if (outcome.status === 'merged') merged += 1
    else console.log(`skipped (${outcome.reason}) ${label}`)
  }
  console.log(`${merged}/${clusters.length} clusters merged`)
}

const main = async (): Promise<void> => {
  const planFile = argValue('--plan')
  const applyFile = argValue('--apply')
  if (Boolean(planFile) === Boolean(applyFile)) {
    throw new Error('Pass exactly one of --plan <file> or --apply <file>')
  }
  const connectionString = resolveConnectionString()
  console.log(`DB: ${maskConnectionString(connectionString)}`)
  const sql = postgres(connectionString)
  try {
    if (planFile) await plan(sql, planFile)
    else await apply(sql, applyFile!)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
