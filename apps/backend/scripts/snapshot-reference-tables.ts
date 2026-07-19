import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Data-only snapshot of the reference tables (wiktionary + lemma ranks) that
// `pnpm db:reset` restores after wiping the dev-tunnel DB. Both loaders
// refresh it at the end of a local run — load-kaikki.ts and
// build-lemma-ranks.ts — so the snapshot always reflects the latest loaded
// state of ALL reference tables, whichever script ran last.
export const REFERENCE_TABLES = [
  'public.wiktionary_entries',
  'public.wiktionary_forms',
  'public.wiktionary_form_redirects',
  'public.lemma_ranks',
  'public.lemma_rank_builds',
] as const

const __dirname = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_DIR = join(__dirname, '.cache', 'wiktionary')
export const SNAPSHOT_PATH = join(SNAPSHOT_DIR, 'wiktionary.dump')

// Run pg_dump inside the Supabase Postgres container so the client tool
// version always matches the server. Hardcoded container name targets the
// dev-tunnel instance; refactor to a parameter if this script ever needs to
// snapshot another instance.
const SUPABASE_CONTAINER = 'supabase_db_supabase-dev-tunnel'

export const snapshotReferenceTables = async (): Promise<void> => {
  if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true })
  // Write to a tmp path and rename on success so a failed pg_dump never
  // leaves a zero-byte file masquerading as a valid snapshot.
  const tmpPath = SNAPSHOT_PATH + '.tmp'
  if (existsSync(tmpPath)) unlinkSync(tmpPath)

  const out = createWriteStream(tmpPath)
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'docker',
      [
        'exec',
        '-i',
        SUPABASE_CONTAINER,
        'pg_dump',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '--data-only',
        ...REFERENCE_TABLES.map((table) => `--table=${table}`),
        '-Fc',
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    )
    proc.stdout.pipe(out)
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${code}`))))
  })

  if (existsSync(SNAPSHOT_PATH)) unlinkSync(SNAPSHOT_PATH)
  renameSync(tmpPath, SNAPSHOT_PATH)

  const sizeMb = (statSync(SNAPSHOT_PATH).size / 1024 / 1024).toFixed(1)
  console.log(`  ✓ Snapshot saved at ${SNAPSHOT_PATH} (${sizeMb} MB)`)
}
