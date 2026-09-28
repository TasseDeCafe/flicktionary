import { fileURLToPath } from 'node:url'
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { snapshotReferenceTables } from './snapshot-reference-tables'
import { DEFAULT_LOCAL_DEV_CONNECTION, maskConnectionString, resolveConnectionString } from './db-connection'
import { WORD_FAMILY_LANGUAGES } from './kaikki-languages'
import { parseWordFamily } from '../src/service/word-family/parse-word-family'
import { computeWordFamilyEdges, type EntryFamilyFacts } from '../src/service/word-family/compute-word-family-edges'

// Rebuilds public.wiktionary_word_family_edges: each content-word entry's
// ancestors (form-of + structural etymology, followed up to depth 3) and its
// stem-filtered related words, all checkpoint_fold-folded so the gloss-time
// lookup joins straight against known_lemmas / saved-term lemma keys. See the
// migration and docs/proposals/word-family-hints.md.
//
// Lifecycle mirrors build-wiktionary-redirects.ts: load-kaikki.ts calls it
// with mode 'truncate' after reloading the source tables; standalone runs
// (`npx tsx scripts/build-word-family.ts [lang...]`) DELETE per language.

// Anchors must be content words — otherwise function words and particles
// (de ab / vor / mit) would surface as "you know" anchors for every
// separable verb.
const CONTENT_POS = ['noun', 'verb', 'adj', 'adv'] as const
const MIN_LEMMA_LETTERS = 3
const FOLD_BATCH = 5_000
const INSERT_BATCH = 5_000
const CURSOR_BATCH = 2_000

type EntryFacts = { folded: string; pos: string; parents: string[]; relatedWords: string[] }

type Db = Sql | TransactionSql

const letterCount = (s: string): number => [...s].length

// Folds raw strings through the SQL checkpoint_fold itself — the scripts
// don't import the TS twin, and the SQL side is what the lemma keys use.
const foldAll = async (sql: Db, lang: string, raw: Iterable<string>): Promise<Map<string, string>> => {
  const values = [...new Set(raw)]
  const out = new Map<string, string>()
  for (let i = 0; i < values.length; i += FOLD_BATCH) {
    const batch = values.slice(i, i + FOLD_BATCH)
    const rows = (await sql`
      SELECT s AS raw, public.checkpoint_fold(s, ${lang}) AS folded
      FROM unnest(${sql.array(batch)}::text[]) AS s
    `) as Array<{ raw: string; folded: string }>
    for (const row of rows) out.set(row.raw, row.folded)
  }
  return out
}

const buildLanguage = async (sql: Db, lang: string): Promise<number> => {
  // Real content lemmas: the only words allowed as relatives.
  const contentRows = (await sql`
    SELECT DISTINCT public.checkpoint_fold(headword, ${lang}) AS folded
    FROM public.wiktionary_entries
    WHERE target_language = ${lang}
      AND pos IN ${sql(CONTENT_POS)}
      AND data ? 'head_templates'
      AND NOT (data->'senses'->0 ? 'form_of')
      AND NOT (data->'senses'->0 ? 'alt_of')
  `) as Array<{ folded: string }>
  const contentLemmas = new Set(
    contentRows.map((r) => r.folded).filter((folded) => letterCount(folded) >= MIN_LEMMA_LETTERS)
  )

  // Stream only the projection the parser reads: templates, form-of senses,
  // related/derived lists.
  const facts: EntryFacts[] = []
  const rawStrings = new Set<string>()
  const rawPrefixes = new Set<string>()
  const cursor = sql`
    SELECT
      public.checkpoint_fold(headword, ${lang}) AS folded,
      pos,
      data->'etymology_templates' AS etymology_templates,
      (
        SELECT jsonb_agg(jsonb_build_object('form_of', s->'form_of', 'tags', s->'tags'))
        FROM jsonb_array_elements(data->'senses') s
        WHERE s ? 'form_of'
      ) AS senses,
      data->'related' AS related,
      data->'derived' AS derived
    FROM public.wiktionary_entries
    WHERE target_language = ${lang}
      AND pos IN ${sql(CONTENT_POS)}
      AND (
        data ? 'etymology_templates'
        OR data ? 'related'
        OR data ? 'derived'
        OR jsonb_path_exists(data, '$.senses[*].form_of')
      )
  `.cursor(CURSOR_BATCH)
  for await (const rows of cursor as AsyncIterable<
    Array<{
      folded: string
      pos: string
      etymology_templates: unknown
      senses: unknown
      related: unknown
      derived: unknown
    }>
  >) {
    for (const row of rows) {
      if (letterCount(row.folded) < MIN_LEMMA_LETTERS) continue
      const parsed = parseWordFamily(row, lang)
      for (const part of parsed.parts ?? []) {
        if (part.isAffix && part.text.endsWith('-') && !part.text.startsWith('-')) {
          rawPrefixes.add(part.text.slice(0, -1))
        }
      }
      if (parsed.parents.length === 0 && parsed.relatedWords.length === 0) continue
      for (const s of parsed.parents) rawStrings.add(s)
      for (const s of parsed.relatedWords) rawStrings.add(s)
      facts.push({ folded: row.folded, pos: row.pos, parents: parsed.parents, relatedWords: parsed.relatedWords })
    }
  }

  const folded = await foldAll(sql, lang, [...rawStrings, ...rawPrefixes])
  const prefixes = [...new Set([...rawPrefixes].map((p) => folded.get(p) ?? p))].filter((p) => p.length > 0)
  const foldContent = (raw: string[], self: string): string[] => {
    const out = new Set<string>()
    for (const r of raw) {
      const f = folded.get(r)
      if (f && f !== self && contentLemmas.has(f)) out.add(f)
    }
    return [...out]
  }

  const familyFacts: EntryFamilyFacts[] = facts.map((fact) => ({
    lemma: fact.folded,
    pos: fact.pos,
    parents: foldContent(fact.parents, fact.folded),
    relatedWords: foldContent(fact.relatedWords, fact.folded),
  }))
  const rows = computeWordFamilyEdges(familyFacts, prefixes)
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH)
    await sql`
      INSERT INTO public.wiktionary_word_family_edges (target_language, lemma, lemma_pos, relative, kind, depth)
      SELECT ${lang}, lemma, lemma_pos, relative, kind, depth
      FROM unnest(
        ${sql.array(batch.map((e) => e.lemma))}::text[],
        ${sql.array(batch.map((e) => e.lemmaPos))}::text[],
        ${sql.array(batch.map((e) => e.relative))}::text[],
        ${sql.array(batch.map((e) => e.kind))}::text[],
        ${sql.array(batch.map((e) => e.depth))}::smallint[]
      ) AS t(lemma, lemma_pos, relative, kind, depth)
      ON CONFLICT DO NOTHING
    `
  }
  return rows.length
}

export const rebuildWordFamilyEdges = async (
  sql: Db,
  languages: readonly string[],
  mode: 'truncate' | 'delete'
): Promise<void> => {
  if (mode === 'truncate') {
    console.log('Truncating wiktionary_word_family_edges...')
    await sql`TRUNCATE public.wiktionary_word_family_edges`
  }
  for (const lang of languages) {
    if (mode === 'delete') {
      await sql`DELETE FROM public.wiktionary_word_family_edges WHERE target_language = ${lang}`
    }
    const t = Date.now()
    const count = await buildLanguage(sql, lang)
    console.log(
      `  ✓ ${lang}: ${count.toLocaleString()} word-family edges built in ${((Date.now() - t) / 1000).toFixed(1)}s`
    )
  }
}

const main = async (): Promise<void> => {
  const connectionString = resolveConnectionString()
  console.log(`Connecting to ${maskConnectionString(connectionString)}`)

  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const languages = args.length > 0 ? args : [...WORD_FAMILY_LANGUAGES]

  const sql = postgres(connectionString, { max: 1 })
  try {
    await sql`SET statement_timeout = '30min'`
    await sql.begin(async (tx) => {
      await rebuildWordFamilyEdges(tx, languages, 'delete')
    })
    await sql`ANALYZE public.wiktionary_word_family_edges`
  } finally {
    await sql.end()
  }

  if (connectionString === DEFAULT_LOCAL_DEV_CONNECTION) {
    console.log('\nSnapshotting reference tables for fast db reset...')
    await snapshotReferenceTables()
  } else {
    console.log('\nSkipping snapshot (only relevant for the local dev tunnel DB).')
  }
  console.log('✓ Done.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error('FAILED:', err)
    process.exit(1)
  })
}
