import { spawn } from 'node:child_process'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, '.cache', 'kaikki')
const SNAPSHOT_DIR = join(__dirname, '.cache', 'wiktionary')
const SNAPSHOT_PATH = join(SNAPSHOT_DIR, 'wiktionary.dump')

const TARGET_LANGUAGE = 'ru'
const KAIKKI_URL = 'https://kaikki.org/dictionary/Russian/kaikki.org-dictionary-Russian.jsonl'
const JSONL_FILENAME = 'kaikki-russian.jsonl'

// Hardcoded for local dev work. The dev-tunnel Supabase connection string is
// also hardcoded in apps/backend/src/config/environment-config.ts; we duplicate
// it here so the loader can run as a standalone tsx script without booting the
// app's config layer. Override with SUPABASE_CONNECTION_STRING if needed.
const DEFAULT_LOCAL_DEV_CONNECTION = 'postgresql://postgres:postgres@127.0.0.1:34322/postgres'

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
}

async function downloadIfMissing(): Promise<string> {
  const path = join(CACHE_DIR, JSONL_FILENAME)
  if (existsSync(path)) {
    const sizeMb = (statSync(path).size / 1024 / 1024).toFixed(1)
    console.log(`✓ Using cached dump (${sizeMb} MB) at ${path}`)
    return path
  }

  console.log(`Downloading ${KAIKKI_URL}...`)
  const res = await fetch(KAIKKI_URL)
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`)
  }
  const total = parseInt(res.headers.get('content-length') ?? '0', 10)
  const totalMb = total ? (total / 1024 / 1024).toFixed(0) : '?'
  let downloaded = 0
  let lastReport = 0
  const out = createWriteStream(path)
  const reader = res.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out.write(value)
    downloaded += value.length
    if (downloaded - lastReport > 50_000_000) {
      const mb = (downloaded / 1024 / 1024).toFixed(0)
      console.log(`  ${mb}/${totalMb} MB downloaded...`)
      lastReport = downloaded
    }
  }
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve())
    out.on('error', reject)
  })
  console.log(`✓ Downloaded to ${path}`)
  return path
}

function csvEscape(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

// U+0301 = combining acute accent. Russian kaikki entries store stressed forms
// in `forms[]` (e.g. "обнару́жил"); LLM-emitted headwords are always unstressed.
// We index stress-stripped versions so plain lookups hit.
function stripStress(s: string): string {
  return s.replace(/́/g, '')
}

// kaikki packs internal metadata into the same `forms[]` array as real surface
// forms. Skip those — they're not lookup-able strings.
const NON_FORM_TAGS = new Set([
  'romanization',
  'class',
  'inflection-template',
  'table-tags',
])

function isRealForm(tags: unknown): boolean {
  if (!Array.isArray(tags)) return true
  for (const t of tags) {
    if (typeof t === 'string' && NON_FORM_TAGS.has(t)) return false
  }
  return true
}

interface CsvOutputs {
  entriesCsv: string
  formsCsv: string
  entryCount: number
  formCount: number
  parseErrors: number
  skippedNoWordOrPos: number
}

async function generateCsvs(jsonlPath: string): Promise<CsvOutputs> {
  const entriesCsv = join(CACHE_DIR, 'entries.csv')
  const formsCsv = join(CACHE_DIR, 'forms.csv')
  const entriesOut = createWriteStream(entriesCsv)
  const formsOut = createWriteStream(formsCsv)

  const rl = createInterface({
    input: createReadStream(jsonlPath),
    crlfDelay: Infinity,
  })

  let entryId = 0
  let entryCount = 0
  let formCount = 0
  let parseErrors = 0
  let skippedNoWordOrPos = 0

  for await (const line of rl) {
    if (!line) continue
    let entry: { word?: unknown; pos?: unknown; forms?: unknown }
    try {
      entry = JSON.parse(line) as typeof entry
    } catch {
      parseErrors++
      continue
    }
    const word = typeof entry.word === 'string' ? entry.word : ''
    const pos = typeof entry.pos === 'string' ? entry.pos : ''
    if (!word || !pos) {
      skippedNoWordOrPos++
      continue
    }

    entryId++
    entriesOut.write(
      `${entryId},${csvEscape(TARGET_LANGUAGE)},${csvEscape(word)},${csvEscape(pos)},${csvEscape(line)}\n`
    )
    entryCount++

    if (Array.isArray(entry.forms)) {
      const seen = new Set<string>()
      for (const f of entry.forms as Array<{ form?: unknown; tags?: unknown }>) {
        const raw = typeof f?.form === 'string' ? f.form.trim() : ''
        if (!raw || raw === '-') continue
        if (!isRealForm(f.tags)) continue
        const formStr = stripStress(raw)
        if (!formStr || seen.has(formStr)) continue
        seen.add(formStr)
        formsOut.write(`${csvEscape(TARGET_LANGUAGE)},${csvEscape(formStr)},${entryId}\n`)
        formCount++
      }
    }

    if (entryCount % 50_000 === 0) {
      console.log(`  ${entryCount.toLocaleString()} entries processed...`)
    }
  }

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      entriesOut.end(() => resolve())
      entriesOut.on('error', reject)
    }),
    new Promise<void>((resolve, reject) => {
      formsOut.end(() => resolve())
      formsOut.on('error', reject)
    }),
  ])

  return { entriesCsv, formsCsv, entryCount, formCount, parseErrors, skippedNoWordOrPos }
}

async function loadCsvs(
  connectionString: string,
  entriesCsv: string,
  formsCsv: string
): Promise<void> {
  const sql = postgres(connectionString, { max: 1 })
  try {
    console.log('Truncating existing wiktionary tables...')
    await sql`TRUNCATE public.wiktionary_forms, public.wiktionary_entries RESTART IDENTITY CASCADE`

    console.log('Loading entries via COPY...')
    const tEntries = Date.now()
    const entriesWritable = await sql`
      COPY public.wiktionary_entries (id, target_language, headword, pos, data)
      FROM STDIN WITH (FORMAT csv)
    `.writable()
    await pipeline(createReadStream(entriesCsv), entriesWritable)
    console.log(`  ✓ entries loaded in ${((Date.now() - tEntries) / 1000).toFixed(1)}s`)

    console.log('Bumping wiktionary_entries id_seq to MAX(id)...')
    await sql`
      SELECT setval(
        pg_get_serial_sequence('public.wiktionary_entries', 'id'),
        COALESCE((SELECT MAX(id) FROM public.wiktionary_entries), 1)
      )
    `

    console.log('Loading forms via COPY...')
    const tForms = Date.now()
    const formsWritable = await sql`
      COPY public.wiktionary_forms (target_language, form, entry_id)
      FROM STDIN WITH (FORMAT csv)
    `.writable()
    await pipeline(createReadStream(formsCsv), formsWritable)
    console.log(`  ✓ forms loaded in ${((Date.now() - tForms) / 1000).toFixed(1)}s`)

    const [entriesCount] = await sql<[{ count: number }]>`
      SELECT COUNT(*)::int AS count FROM public.wiktionary_entries
    `
    const [formsCount] = await sql<[{ count: number }]>`
      SELECT COUNT(*)::int AS count FROM public.wiktionary_forms
    `
    console.log(
      `\nFinal counts: ${entriesCount.count.toLocaleString()} entries, ${formsCount.count.toLocaleString()} forms`
    )

    console.log("\nSample lookup: headword = 'обнаружить'")
    const sample = await sql`
      SELECT id, headword, pos, jsonb_array_length(COALESCE(data->'senses', '[]'::jsonb)) AS sense_count,
             jsonb_array_length(COALESCE(data->'forms', '[]'::jsonb)) AS form_count
      FROM public.wiktionary_entries
      WHERE target_language = 'ru' AND headword = 'обнаружить'
    `
    console.log(JSON.stringify(sample, null, 2))

    console.log("\nSample lookup via wiktionary_forms: form = 'обнаружил'")
    const formSample = await sql`
      SELECT e.id, e.headword, e.pos
      FROM public.wiktionary_forms f
      JOIN public.wiktionary_entries e ON e.id = f.entry_id
      WHERE f.target_language = 'ru' AND f.form = 'обнаружил'
    `
    console.log(JSON.stringify(formSample, null, 2))
  } finally {
    await sql.end()
  }
}

async function main(): Promise<void> {
  const envValue = process.env.SUPABASE_CONNECTION_STRING ?? ''
  const connectionString = envValue.startsWith('postgresql://')
    ? envValue
    : DEFAULT_LOCAL_DEV_CONNECTION
  console.log(`Connecting to ${connectionString.replace(/:[^:@]+@/, ':****@')}`)

  ensureCacheDir()
  const jsonlPath = await downloadIfMissing()

  console.log('\nGenerating CSVs from JSONL...')
  const tCsv = Date.now()
  const out = await generateCsvs(jsonlPath)
  console.log(
    `✓ Generated ${out.entryCount.toLocaleString()} entries, ${out.formCount.toLocaleString()} forms in ${((Date.now() - tCsv) / 1000).toFixed(1)}s`
  )
  if (out.parseErrors > 0) console.warn(`  ⚠ ${out.parseErrors} JSONL lines failed to parse`)
  if (out.skippedNoWordOrPos > 0)
    console.warn(`  ⚠ ${out.skippedNoWordOrPos} entries skipped (missing word/pos)`)

  console.log('\nLoading into DB...')
  await loadCsvs(connectionString, out.entriesCsv, out.formsCsv)

  console.log('\nSnapshotting wiktionary tables for fast db reset...')
  await snapshotWiktionary(connectionString)

  console.log('\n✓ Done.')
}

// Run pg_dump inside the Supabase Postgres container so the client tool
// version always matches the server. Hardcoded container name targets the
// dev-tunnel instance; refactor to a parameter if this script ever needs to
// snapshot another instance.
const SUPABASE_CONTAINER = 'supabase_db_supabase-dev-tunnel'

async function snapshotWiktionary(_connectionString: string): Promise<void> {
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
        '--table=public.wiktionary_entries',
        '--table=public.wiktionary_forms',
        '-Fc',
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    )
    proc.stdout.pipe(out)
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${code}`))
    )
  })

  if (existsSync(SNAPSHOT_PATH)) unlinkSync(SNAPSHOT_PATH)
  renameSync(tmpPath, SNAPSHOT_PATH)

  const sizeMb = (statSync(SNAPSHOT_PATH).size / 1024 / 1024).toFixed(1)
  console.log(`  ✓ Snapshot saved at ${SNAPSHOT_PATH} (${sizeMb} MB)`)
}

main().catch((err: unknown) => {
  console.error('FAILED:', err)
  process.exit(1)
})
