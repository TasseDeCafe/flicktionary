import { execSync } from 'node:child_process'
import { connect } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_DB_PORT = 64322

const supabaseTestDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/supabase-test/supabase'
)

const isTestStackReachable = () =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: TEST_DB_PORT })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })

// The shared supabase-test stack is never reset, so a newly created migration
// only reaches it when something applies it. Applying pending migrations here
// — once per vitest invocation — keeps the test schema in sync with the repo
// no matter how the tests were started: the test:integration scripts, the
// pre-push hook's bare `vitest run`, or a direct single-file run.
export const setup = async () => {
  if (!(await isTestStackReachable())) {
    const hint = `supabase-test stack is not running on port ${TEST_DB_PORT} — start it with: pnpm --filter @flicktionary/backend db:test`
    if (process.env.VITEST_ENV === 'integration') {
      throw new Error(hint)
    }
    // A mixed run (no VITEST_ENV) may only be executing unit files; warn
    // instead of blocking so those still work without the stack.
    console.warn(`⚠️  ${hint} (integration tests will fail; unit tests are unaffected)`)
    return
  }

  try {
    const output = execSync('supabase migration up', {
      cwd: supabaseTestDir,
      encoding: 'utf8',
    })
    // The CLI output only matters when it actually applied something.
    if (output.includes('Applying migration')) {
      console.log(`[supabase-test] ${output.trim()}`)
    }
  } catch (error) {
    throw new Error(
      'Failed to apply migrations to the supabase-test stack (see stderr above) — the test schema may have drifted from apps/backend/supabase/migrations',
      { cause: error }
    )
  }
}
