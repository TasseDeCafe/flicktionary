import { describe, expect, test } from 'vitest'
import { foldCheckpointToken } from '@flicktionary/core/utils/checkpoint-fold'
import { sql } from '../postgres-client'

// Byte-pinning guard: public.checkpoint_fold (migration
// 20260718023224_checkpoint_fold_index.sql) and foldCheckpointToken
// (packages/core/src/utils/checkpoint-fold.ts) must produce identical output
// for identical input — the wiktionary side folds through SQL expression
// indexes while tokens and user headwords fold in TS, and any divergence
// silently breaks matching. Change both implementations in lockstep or
// neither.
describe('checkpoint_fold SQL-vs-TS parity', () => {
  // Inputs cover: stress marks, case, ё both cases, ß/ẞ, decomposed combining
  // marks (U+0308), surrounding whitespace, multi-word strings, hyphens,
  // apostrophes, digits, and the empty string — across ru/de/en plus an
  // unconfigured language (base fold only).
  const vectors: Array<{ input: string; lang: string }> = [
    { input: 'Стола́', lang: 'ru' },
    { input: 'ЁЖ', lang: 'ru' },
    { input: 'всё', lang: 'ru' },
    { input: 'обнару́жил', lang: 'ru' },
    { input: 'Ещё', lang: 'ru' },
    { input: 'Straße', lang: 'de' },
    { input: 'STRAẞE', lang: 'de' },
    { input: 'Bär', lang: 'de' },
    { input: 'Bär', lang: 'de' },
    { input: 'sich freuen', lang: 'de' },
    { input: '  Running  ', lang: 'en' },
    { input: 'to run', lang: 'en' },
    { input: "don't", lang: 'en' },
    { input: 'passer-by', lang: 'en' },
    { input: 'Straße', lang: 'en' },
    { input: 'ёлка', lang: 'en' },
    { input: 'Käse42', lang: 'de' },
    { input: '', lang: 'ru' },
  ]

  test('SQL and TS folds agree on every vector', async () => {
    for (const { input, lang } of vectors) {
      const [row] = (await sql`
        SELECT public.checkpoint_fold(${input}, ${lang}) AS folded
      `) as [{ folded: string }]
      expect(row.folded, `input=${JSON.stringify(input)} lang=${lang}`).toBe(foldCheckpointToken(input, lang))
    }
  })
})
