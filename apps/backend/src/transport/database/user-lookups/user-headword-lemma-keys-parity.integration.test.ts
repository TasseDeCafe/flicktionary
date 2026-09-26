import { describe, expect, test } from 'vitest'
import { foldUserHeadwordCandidates } from '@flicktionary/core/utils/checkpoint-fold'
import { sql } from '../postgres-client'

// Byte-pinning guard: public.user_headword_lemma_keys (migration
// 20260926103159_lookup_demand_signal.sql) and foldUserHeadwordCandidates
// (packages/core/src/utils/checkpoint-fold.ts) must produce the same key set —
// lookups resolve saved terms through the SQL side while checkpoints and the
// difficulty stat fold in TS, and a divergence silently drops demand. Change
// both implementations in lockstep or neither.
describe('user_headword_lemma_keys SQL-vs-TS parity', () => {
  // Every per-language strip (en `to `, de `sich `, fr `se `, es infinitive
  // reflexives, pt hyphenated reflexives) plus the look-alikes each rule must
  // leave alone, stress/case folding, elisions, and a bare particle.
  const vectors: Array<{ headword: string; lang: string }> = [
    { headword: 'To Run', lang: 'en' },
    { headword: 'to', lang: 'en' },
    { headword: 'tomato', lang: 'en' },
    { headword: 'to foist on', lang: 'en' },
    { headword: 'sich freuen', lang: 'de' },
    { headword: 'Sichtweise', lang: 'de' },
    { headword: 'se laver', lang: 'fr' },
    { headword: "s'appeler", lang: 'fr' },
    { headword: 'semer', lang: 'fr' },
    { headword: 'ducharse', lang: 'es' },
    { headword: 'ponerse', lang: 'es' },
    { headword: 'irse', lang: 'es' },
    { headword: 'clase', lang: 'es' },
    { headword: 'queixar-se', lang: 'pt' },
    { headword: '-se', lang: 'pt' },
    { headword: 'Стола́', lang: 'ru' },
    { headword: 'учиться', lang: 'ru' },
    { headword: 'в поте лица', lang: 'ru' },
    { headword: 'to run', lang: 'de' },
  ]

  test('SQL and TS key sets agree on every vector', async () => {
    for (const { headword, lang } of vectors) {
      const [row] = (await sql`
        SELECT public.user_headword_lemma_keys(${headword}, ${lang}) AS keys
      `) as [{ keys: string[] }]
      expect([...row.keys].sort(), `headword=${JSON.stringify(headword)} lang=${lang}`).toEqual(
        [...foldUserHeadwordCandidates(headword, lang)].sort()
      )
    }
  })
})
