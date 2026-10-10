import { SCENARIOS, findScenario } from '../src/transport/database/dev-tools/scenarios/scenarios'
import {
  assertDevTunnelNodeEnv,
  assertDevTunnelTarget,
  assertScenarioEmail,
  DEFAULT_SCENARIO_EMAIL,
} from '../src/transport/database/dev-tools/scenarios/dev-scenario-guard'

// Puts a dev-tunnel account into an exact practice state in seconds — no LLM
// calls, no manual practice — and prints a magic sign-in link. See
// src/transport/database/dev-tools/scenarios/README.md.
//
// Usage (from the repo root or apps/backend):
//   pnpm dev:scenario                          # list scenarios
//   pnpm dev:scenario <name> [--email dev-scenario…@…] [--web-url <url>]
//   pnpm dev:scenario --link [--email …]       # fresh sign-in link only

const DEFAULT_WEB_URL = 'https://web-sebastien.flicktionary.dev'

type Args = { name?: string; email: string; webUrl: string; linkOnly: boolean }

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    email: DEFAULT_SCENARIO_EMAIL,
    webUrl: process.env.DEV_SCENARIO_WEB_URL || DEFAULT_WEB_URL,
    linkOnly: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--email') args.email = argv[++i] ?? ''
    else if (arg === '--web-url') args.webUrl = argv[++i] ?? ''
    else if (arg === '--link') args.linkOnly = true
    else if (arg === '--') continue
    else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`)
    else if (args.name) throw new Error(`Only one scenario at a time (got ${args.name} and ${arg})`)
    else args.name = arg
  }
  return args
}

const listScenarios = (): void => {
  console.log('Scenarios (pnpm dev:scenario <name>):\n')
  for (const scenario of SCENARIOS) {
    console.log(`  ${scenario.name}\n    ${scenario.description}\n`)
  }
  console.log('Flags: --email dev-scenario…@… (default dev-scenario@flicktionary.app), --web-url <url>, --link')
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  if (!args.name && !args.linkOnly) {
    listScenarios()
    return
  }
  const spec = args.name ? findScenario(args.name) : undefined
  if (args.name && !spec) {
    listScenarios()
    throw new Error(`Unknown scenario: ${args.name}`)
  }
  assertScenarioEmail(args.email)

  // The app config (and the database it points at) is chosen from NODE_ENV:
  // check it before importing anything that reads the config.
  assertDevTunnelNodeEnv(process.env.NODE_ENV)
  const { getConfig } = await import('../src/config/environment-config')
  const config = getConfig()
  assertDevTunnelTarget({ connectionString: config.supabaseConnectionString, supabaseUrl: config.supabaseProjectUrl })

  const { sql } = await import('../src/transport/database/postgres-client')
  const { getSupabase } = await import('../src/transport/database/supabase')
  const { WordFamilyRepository } = await import('../src/transport/database/word-family/word-family-repository')
  const { WiktionaryMatchRepository } =
    await import('../src/transport/database/wiktionary-entries/wiktionary-match-repository')
  const { prepareScenario, seedScenario, verifyScenarioFamilies } =
    await import('../src/transport/database/dev-tools/scenarios/seed-scenario')
  const admin = getSupabase()

  try {
    let userId: string
    let readingSessionId: string | null = null
    if (spec) {
      const wordFamilyDeps = {
        wordFamilyRepository: WordFamilyRepository(),
        wiktionaryMatchRepository: WiktionaryMatchRepository(),
        // Insights are cached by the seed; the read-back path never generates.
        anthropicPasses: {
          wordFamilyInsightPass: () => Promise.reject(new Error('dev:scenario never generates insights')),
        },
      }
      // Read-only prerequisite check first: nothing is wiped if it fails.
      const prepared = await prepareScenario(spec, wordFamilyDeps, { requireDictionary: true })

      const { error } = await admin.auth.admin.createUser({ email: args.email, email_confirm: true })
      if (error && error.code !== 'email_exists' && !/already.*registered/i.test(error.message)) throw error
      userId = await findUserId(sql, args.email)

      ;({ readingSessionId } = await seedScenario({ userId, prepared }))
      console.log(`Seeded ${spec.name} for ${args.email} (${userId}).\n\n${spec.description}\n`)

      const problems = await verifyScenarioFamilies({ userId, prepared }, wordFamilyDeps)
      if (problems.length > 0) {
        throw new Error(`Seeded, but the word-family lines don't match the scenario:\n  ${problems.join('\n  ')}`)
      }
      console.log('Try it:')
      for (const line of spec.tryIt) console.log(`  - ${line.replaceAll('<scenario email>', args.email)}`)
    } else {
      userId = await findUserId(sql, args.email)
    }

    // Lands on the scenario's reading session when it seeded one, else on the
    // language's practice screen, after Verify. The token is
    // single-use and expires with GoTrue's OTP lifetime; --link mints another.
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: args.email })
    if (error) throw error
    const language = spec?.targetLanguage ?? 'ru'
    const params = new URLSearchParams({
      token_hash: data.properties.hashed_token,
      redirect: readingSessionId ? `/sessions/${readingSessionId}` : `/practice/language/${language}`,
    })
    console.log(`\nSign in (open, then press Verify):\n  ${args.webUrl}/login/email/verify?${params.toString()}`)
    console.log(`\nAdvance a day:  pnpm db:advance-day --email ${args.email}`)
  } finally {
    await sql.end()
  }
}

const findUserId = async (sql: typeof import('../src/transport/database/postgres-client').sql, email: string) => {
  const rows = (await sql`SELECT id FROM auth.users WHERE lower(email) = lower(${email})`) as Array<{ id: string }>
  if (!rows[0]) throw new Error(`No auth user for ${email} — run a scenario first`)
  return rows[0].id
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
