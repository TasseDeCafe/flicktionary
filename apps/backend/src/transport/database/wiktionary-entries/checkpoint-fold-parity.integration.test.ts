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
  // marks (U+0308 and orthographic acutes that must survive via NFC-first),
  // surrounding whitespace, multi-word strings, hyphens, apostrophes, digits,
  // and the empty string — across ru/de/en plus unconfigured languages (base
  // fold only).
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
    // Decomposed orthographic acutes (written as escapes so no editor can
    // silently re-normalize them) — NFC must compose them before the strip so
    // they fold with the accent intact (más, not mas).
    { input: 'ma\u0301s', lang: 'es' },
    { input: 'avo\u0301', lang: 'pt' },
    { input: 'e\u0301te\u0301', lang: 'fr' },
    { input: 'cafe\u0301', lang: 'en' },
    // Vietnamese double mark: e + circumflex + acute composes to ế.
    { input: 'e\u0302\u0301', lang: 'vi' },
    // Decomposed Russian stress mark — still stripped (never composes).
    { input: 'стола\u0301', lang: 'ru' },
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
