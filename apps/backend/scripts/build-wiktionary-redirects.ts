import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'

// Rebuilds public.wiktionary_form_redirects: the precomputed resolution of
// kaikki stub entries (form-of / alt-of pseudo-entries) to their final real
// lemma, followed up to 2 hops (de "dies" → alt-of → "dieses" → form-of →
// "dieser"). A redirect row is written ONLY when the chain ends on a real
// lemma (`data ? 'head_templates'` and not itself a stub) — dead-end chains
// are dropped. The checkpoint matcher reads this table as its third
// resolution arm (see wiktionary-match-repository.ts).
//
// Lifecycle: load-kaikki.ts TRUNCATEs and reloads the wiktionary source
// tables, then calls rebuildWiktionaryRedirects with mode 'truncate' so the
// redirects rebuild in the same run. Standalone invocations
// (`npx tsx scripts/build-wiktionary-redirects.ts [lang...]`) are
// language-scoped: DELETE WHERE target_language = $lang, never TRUNCATE.

const DEFAULT_LOCAL_DEV_CONNECTION = 'postgresql://postgres:postgres@127.0.0.1:34322/postgres'
const DEFAULT_LANGUAGES = ['ru', 'en', 'de', 'es', 'pt'] as const

// U+0301 combining acute — Russian stress mark; stub targets carry it, entry
// headwords don't. Bound as a parameter (not a SQL U&'' literal) so the JS
// template never has to escape it.
const COMBINING_ACUTE = '́'

export const rebuildWiktionaryRedirects = async (
  sql: Sql,
  languages: readonly string[],
  mode: 'truncate' | 'delete'
): Promise<void> => {
  if (mode === 'truncate') {
    console.log('Truncating wiktionary_form_redirects...')
    await sql`TRUNCATE public.wiktionary_form_redirects`
  }

  for (const lang of languages) {
    if (mode === 'delete') {
      await sql`DELETE FROM public.wiktionary_form_redirects WHERE target_language = ${lang}`
    }
    const t = Date.now()
    // One set-based statement per language. Stubs point at their target via
    // senses[0].form_of[0].word or senses[0].alt_of[0].word (stress-marked in
    // Russian — strip U+0301 to match the unstressed entry headwords; NFC
    // first so orthographic accents in decomposed input survive the strip).
    // Self-redirects (folded stub headword equals the folded final lemma) are
    // dropped: the matcher's direct-headword arm already resolves those.
    const [{ count }] = (await sql`
      WITH stubs AS (
        SELECT
          headword,
          regexp_replace(
            normalize(
              COALESCE(
                data->'senses'->0->'form_of'->0->>'word',
                data->'senses'->0->'alt_of'->0->>'word'
              ),
              NFC
            ),
            ${COMBINING_ACUTE}, '', 'g'
          ) AS target
        FROM public.wiktionary_entries
        WHERE target_language = ${lang}
          AND (data->'senses'->0 ? 'form_of' OR data->'senses'->0 ? 'alt_of')
      ),
      real_lemmas AS (
        SELECT DISTINCT headword
        FROM public.wiktionary_entries
        WHERE target_language = ${lang}
          AND data ? 'head_templates'
          AND NOT (data->'senses'->0 ? 'form_of')
          AND NOT (data->'senses'->0 ? 'alt_of')
      ),
      hops AS (
        SELECT s.headword, s.target FROM stubs s WHERE s.target IS NOT NULL
      ),
      resolved AS (
        SELECT h.headword, h.target AS lemma
        FROM hops h
        JOIN real_lemmas r ON r.headword = h.target
        UNION
        SELECT h.headword, s2.target AS lemma
        FROM hops h
        JOIN stubs s2 ON s2.headword = h.target
        JOIN real_lemmas r ON r.headword = s2.target
        WHERE s2.target IS NOT NULL
      ),
      inserted AS (
        INSERT INTO public.wiktionary_form_redirects (target_language, folded_form, lemma)
        SELECT DISTINCT
          ${lang},
          public.checkpoint_fold(headword, ${lang}),
          lemma
        FROM resolved
        WHERE public.checkpoint_fold(headword, ${lang}) <> public.checkpoint_fold(lemma, ${lang})
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM inserted
    `) as [{ count: number }]
    console.log(`  ✓ ${lang}: ${count.toLocaleString()} redirects built in ${((Date.now() - t) / 1000).toFixed(1)}s`)
  }
}

const main = async (): Promise<void> => {
  const envValue = process.env.SUPABASE_CONNECTION_STRING ?? ''
  const connectionString = envValue.startsWith('postgresql://') ? envValue : DEFAULT_LOCAL_DEV_CONNECTION
  console.log(`Connecting to ${connectionString.replace(/:[^:@]+@/, ':****@')}`)

  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const languages = args.length > 0 ? args : [...DEFAULT_LANGUAGES]

  const sql = postgres(connectionString, { max: 1 })
  try {
    await sql`SET statement_timeout = '30min'`
    await rebuildWiktionaryRedirects(sql, languages, 'delete')
  } finally {
    await sql.end()
  }
  console.log('✓ Done.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error('FAILED:', err)
    process.exit(1)
  })
}
