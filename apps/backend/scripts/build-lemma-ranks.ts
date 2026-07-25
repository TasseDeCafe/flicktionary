import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'
import {
  checkAcceptance,
  isRealWordToken,
  rankLemmas,
  splitFormMass,
  type FormCandidate,
} from '../src/service/lemma-ranks/build-ranking'
import { snapshotReferenceTables } from './snapshot-reference-tables'

// Builds public.lemma_ranks + its lemma_rank_builds manifest row per language
// from the wordfreq export (scripts/export-wordfreq.py → .cache/wordfreq/) and
// the loaded kaikki tables. Implements the spike-validated rules from
// docs/proposals/vocab-coverage-visualization.md; the pure ranking logic lives
// unit-tested in src/service/lemma-ranks/build-ranking.ts.
//
// Resolution runs INSIDE the database through checkpoint_fold(...), so form →
// lemma matching is byte-for-byte identical to the runtime checkpoint matcher
// (wiktionary-match-repository.ts) — never resolve against local CSV caches.
// Because checkpoint_fold lowercases both sides, one folded lookup already IS
// the spike's "union exact + capitalized keys" rule; candidate weights (not
// match order) arbitrate ambiguity.
//
// Each language publishes atomically: DELETE + insert + manifest upsert in one
// transaction (TRUNCATE cannot target one language). The build fails loud on
// the acceptance thresholds instead of publishing a degraded list.
//
// Usage (from apps/backend, DB conventions mirror load-kaikki.ts):
//   pnpm build:lemma-ranks [lang...]                      # local dev tunnel
//   doppler run --config prd -- npx tsx scripts/build-lemma-ranks.ts ru de en

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORDFREQ_DIR = join(__dirname, '.cache', 'wordfreq')

const DEFAULT_LOCAL_DEV_CONNECTION = 'postgresql://postgres:postgres@127.0.0.1:34322/postgres'
const DEFAULT_LANGUAGES = ['ru', 'en', 'de', 'es', 'pt'] as const

const INSERT_CHUNK = 10_000
const TOP_PRINT = 60

type WordfreqExport = {
  forms: string[]
  frequencies: number[]
  wordfreqVersion: string
}

// The export is machine-written (python csv module) and forms are single
// tokens; quoting only ever appears defensively, so a minimal unquote is
// enough — fail loud on anything fancier.
const parseCsvLine = (line: string): [string, string] => {
  const commaAt = line.startsWith('"') ? line.indexOf('",') + 1 : line.indexOf(',')
  if (commaAt <= 0) throw new Error(`Malformed wordfreq CSV line: ${line}`)
  let form = line.slice(0, commaAt)
  if (form.startsWith('"') && form.endsWith('"')) form = form.slice(1, -1).replace(/""/g, '"')
  return [form, line.slice(commaAt + 1)]
}

const readWordfreqExport = (lang: string): WordfreqExport => {
  const csvPath = join(WORDFREQ_DIR, `${lang}.csv`)
  const metaPath = join(WORDFREQ_DIR, `${lang}.meta.json`)
  if (!existsSync(csvPath) || !existsSync(metaPath)) {
    throw new Error(`Missing wordfreq export for ${lang} — run: uv run scripts/export-wordfreq.py ${lang}`)
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { wordfreqVersion?: string }
  if (!meta.wordfreqVersion) throw new Error(`No wordfreqVersion in ${metaPath}`)

  const lines = readFileSync(csvPath, 'utf8').split('\n')
  const forms: string[] = []
  const frequencies: number[] = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const [form, freqStr] = parseCsvLine(line)
    const frequency = Number(freqStr)
    if (!form || !Number.isFinite(frequency) || frequency <= 0) continue
    forms.push(form)
    frequencies.push(frequency)
  }
  if (forms.length === 0) throw new Error(`Empty wordfreq export at ${csvPath}`)
  return { forms, frequencies, wordfreqVersion: meta.wordfreqVersion }
}

// Folds the raw wordfreq forms through the DATABASE's checkpoint_fold (fold
// parity with the runtime matcher) and sums frequency per folded form —
// wordfreq's ё/е or ß/ss near-duplicates merge here.
const foldForms = async (sql: Sql, lang: string, data: WordfreqExport): Promise<Map<string, number>> => {
  const byFolded = new Map<string, number>()
  for (let i = 0; i < data.forms.length; i += INSERT_CHUNK) {
    const forms = data.forms.slice(i, i + INSERT_CHUNK)
    const frequencies = data.frequencies.slice(i, i + INSERT_CHUNK)
    const rows = (await sql`
      SELECT checkpoint_fold(t.form, ${lang}) AS folded_form, SUM(t.frequency) AS frequency
      FROM unnest(${sql.array(forms)}::text[], ${sql.array(frequencies.map(String))}::float8[]) AS t(form, frequency)
      GROUP BY 1
    `) as Array<{ folded_form: string; frequency: number }>
    for (const row of rows) {
      byFolded.set(row.folded_form, (byFolded.get(row.folded_form) ?? 0) + Number(row.frequency))
    }
  }
  return byFolded
}

type ResolutionRow = { folded_form: string; lemma: string; folded_lemma: string }

// Three resolution arms, mirroring the runtime matcher, plus the build-only
// exclusions (pos = 'character', multi-word lemmas — build rules).
const resolveCandidates = async (
  sql: Sql,
  lang: string,
  foldedForms: readonly string[]
): Promise<Map<string, FormCandidate[]>> => {
  await sql`DROP TABLE IF EXISTS build_tokens`
  await sql`CREATE TEMP TABLE build_tokens (folded_form TEXT PRIMARY KEY)`
  for (let i = 0; i < foldedForms.length; i += INSERT_CHUNK) {
    const chunk = foldedForms.slice(i, i + INSERT_CHUNK)
    await sql`INSERT INTO build_tokens (folded_form) SELECT * FROM unnest(${sql.array(chunk)}::text[])`
  }

  // Real single-word non-character lemma headwords of the language — shared
  // by the redirect arm (redirect targets carry no entry link).
  await sql`DROP TABLE IF EXISTS build_real_lemmas`
  await sql`
    CREATE TEMP TABLE build_real_lemmas AS
    SELECT DISTINCT e.headword, checkpoint_fold(e.headword, e.target_language) AS folded_lemma
    FROM public.wiktionary_entries e
    WHERE e.target_language = ${lang}
      AND e.data ? 'head_templates'
      AND NOT (e.data->'senses'->0 ? 'form_of')
      AND NOT (e.data->'senses'->0 ? 'alt_of')
      AND e.pos <> 'character'
      AND e.headword NOT LIKE '% %'
  `
  await sql`CREATE INDEX ON build_real_lemmas (headword)`
  await sql`ANALYZE build_tokens, build_real_lemmas`

  const rows = (await sql`
    SELECT t.folded_form, e.headword AS lemma, checkpoint_fold(e.headword, e.target_language) AS folded_lemma
    FROM build_tokens t
    JOIN public.wiktionary_forms f
      ON f.target_language = ${lang}
     AND checkpoint_fold(f.form, f.target_language) = t.folded_form
    JOIN public.wiktionary_entries e ON e.id = f.entry_id
    JOIN build_real_lemmas rl ON rl.headword = e.headword
    WHERE e.data ? 'head_templates'
      AND NOT (e.data->'senses'->0 ? 'form_of')
      AND NOT (e.data->'senses'->0 ? 'alt_of')
      AND e.pos <> 'character'
    UNION
    SELECT t.folded_form, e.headword, checkpoint_fold(e.headword, e.target_language)
    FROM build_tokens t
    JOIN public.wiktionary_entries e
      ON e.target_language = ${lang}
     AND checkpoint_fold(e.headword, e.target_language) = t.folded_form
    WHERE e.data ? 'head_templates'
      AND NOT (e.data->'senses'->0 ? 'form_of')
      AND NOT (e.data->'senses'->0 ? 'alt_of')
      AND e.pos <> 'character'
      AND e.headword NOT LIKE '% %'
    UNION
    SELECT t.folded_form, r.lemma, checkpoint_fold(r.lemma, r.target_language)
    FROM build_tokens t
    JOIN public.wiktionary_form_redirects r
      ON r.target_language = ${lang} AND r.folded_form = t.folded_form
    JOIN build_real_lemmas rl ON rl.headword = r.lemma
  `) as ResolutionRow[]

  const byForm = new Map<string, FormCandidate[]>()
  for (const row of rows) {
    const list = byForm.get(row.folded_form)
    const candidate: FormCandidate = { lemma: row.lemma, foldedLemma: row.folded_lemma }
    if (list) {
      list.push(candidate)
    } else {
      byForm.set(row.folded_form, [candidate])
    }
  }
  return byForm
}

const buildLanguage = async (sql: Sql, lang: string): Promise<void> => {
  console.log(`\n=== ${lang} ===`)
  const data = readWordfreqExport(lang)
  console.log(`  ${data.forms.length.toLocaleString()} wordfreq forms (wordfreq ${data.wordfreqVersion})`)

  const freqByFoldedForm = await foldForms(sql, lang, data)

  // Denominator = real word tokens only; digits/symbols/foreign-script tokens
  // never enter the mass accounting.
  const wordTokens = new Map<string, number>()
  for (const [foldedForm, frequency] of freqByFoldedForm) {
    if (isRealWordToken(foldedForm, lang)) wordTokens.set(foldedForm, frequency)
  }
  console.log(
    `  ${wordTokens.size.toLocaleString()} folded word tokens (${(freqByFoldedForm.size - wordTokens.size).toLocaleString()} non-word forms excluded)`
  )

  const candidatesByForm = await resolveCandidates(sql, lang, [...wordTokens.keys()])

  // Epsilon weight for candidate lemmas wordfreq doesn't list: well below the
  // least frequent listed form, so listed candidates always dominate.
  const minListedFrequency = Math.min(...wordTokens.values())
  const epsilonWeight = minListedFrequency / 10

  const massByLemma = new Map<string, number>()
  let totalWordTokenMass = 0
  let matchedWordTokenMass = 0
  for (const [foldedForm, frequency] of wordTokens) {
    totalWordTokenMass += frequency
    const candidates = candidatesByForm.get(foldedForm)
    if (!candidates || candidates.length === 0) continue
    matchedWordTokenMass += frequency
    const split = splitFormMass({
      formFrequency: frequency,
      candidates,
      targetLanguage: lang,
      frequencyOfFoldedLemma: (foldedLemma) => wordTokens.get(foldedLemma),
      epsilonWeight,
    })
    for (const [foldedLemma, mass] of split) {
      massByLemma.set(foldedLemma, (massByLemma.get(foldedLemma) ?? 0) + mass)
    }
  }

  // Floor = the rarest listed form's frequency: lemmas below it carry only
  // epsilon-share slivers whose rank order is corpus noise (see rankLemmas).
  const ranked = rankLemmas(massByLemma, minListedFrequency)
  const positiveMassCount = [...massByLemma.values()].filter((mass) => mass > 0).length
  const droppedCount = positiveMassCount - ranked.length
  const acceptance = checkAcceptance({
    totalWordTokenMass,
    matchedWordTokenMass,
    lemmaCount: ranked.length,
  })

  console.log(`  token mass matched: ${acceptance.massMatchedPct.toFixed(2)}%`)
  console.log(
    `  denominator: ${ranked.length.toLocaleString()} lemmas with mass ≥ floor (${droppedCount.toLocaleString()} epsilon-dust lemmas below ${minListedFrequency.toExponential(2)} dropped)`
  )

  console.log(`  top ${TOP_PRINT} (compare against the spike tables in docs/proposals/vocab-coverage-visualization.md):`)
  let cumulative = 0
  for (const { lemma, rank, freqMass } of ranked.slice(0, TOP_PRINT)) {
    cumulative += freqMass
    const share = ((freqMass / matchedWordTokenMass) * 100).toFixed(2)
    const cumulativePct = ((cumulative / matchedWordTokenMass) * 100).toFixed(1)
    console.log(`    ${String(rank).padStart(3)}  ${lemma.padEnd(20)} ${share.padStart(6)}%  Σ ${cumulativePct}%`)
  }

  if (acceptance.failures.length > 0) {
    throw new Error(`Acceptance failed for ${lang}:\n  - ${acceptance.failures.join('\n  - ')}`)
  }

  // Atomic per-language publish: readers never observe a half-built list, and
  // the manifest row (the difficulty feature's "supported" gate) only ever
  // appears alongside complete data.
  await sql.begin(async (tx) => {
    await tx`DELETE FROM public.lemma_ranks WHERE target_language = ${lang}`
    for (let i = 0; i < ranked.length; i += INSERT_CHUNK) {
      const chunk = ranked.slice(i, i + INSERT_CHUNK)
      await tx`
        INSERT INTO public.lemma_ranks (target_language, lemma, rank, freq_mass)
        SELECT ${lang}, u.lemma, u.rank, u.freq_mass
        FROM unnest(
          ${tx.array(chunk.map((r) => r.lemma))}::text[],
          ${tx.array(chunk.map((r) => String(r.rank)))}::int[],
          ${tx.array(chunk.map((r) => String(r.freqMass)))}::float8[]
        ) AS u(lemma, rank, freq_mass)
      `
    }
    await tx`
      INSERT INTO public.lemma_rank_builds (target_language, version, built_at, wordfreq_version, row_count, mass_matched_pct)
      VALUES (${lang}, 1, now(), ${data.wordfreqVersion}, ${ranked.length}, ${acceptance.massMatchedPct})
      ON CONFLICT (target_language) DO UPDATE SET
        version = public.lemma_rank_builds.version + 1,
        built_at = now(),
        wordfreq_version = EXCLUDED.wordfreq_version,
        row_count = EXCLUDED.row_count,
        mass_matched_pct = EXCLUDED.mass_matched_pct
    `
  })
  console.log(`  ✓ published ${ranked.length.toLocaleString()} lemma_ranks rows for ${lang}`)
}

const main = async (): Promise<void> => {
  const envValue = process.env.SUPABASE_CONNECTION_STRING ?? ''
  const connectionString = envValue.startsWith('postgresql://') ? envValue : DEFAULT_LOCAL_DEV_CONNECTION
  console.log(`Connecting to ${connectionString.replace(/:[^:@]+@/, ':****@')}`)

  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const languages = args.length > 0 ? args : [...DEFAULT_LANGUAGES]

  // onnotice silences the expected "table does not exist, skipping" notices
  // from the DROP TABLE IF EXISTS of the per-language temp tables.
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} })
  try {
    await sql`SET statement_timeout = '30min'`
    for (const lang of languages) {
      await buildLanguage(sql, lang)
    }
  } finally {
    await sql.end()
  }

  if (connectionString === DEFAULT_LOCAL_DEV_CONNECTION) {
    console.log('\nSnapshotting reference tables for fast db reset...')
    await snapshotReferenceTables()
  } else {
    console.log('\nSkipping snapshot (only relevant for the local dev tunnel DB).')
  }

  console.log('\n✓ Done.')
}

main().catch((err: unknown) => {
  console.error('FAILED:', err)
  process.exit(1)
})
