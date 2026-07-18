import { describe, expect, test } from 'vitest'
import { foldCheckpointToken } from '@flicktionary/core/utils/checkpoint-fold'
import { WiktionaryMatchRepository } from './wiktionary-match-repository'
import { rebuildWiktionaryRedirects } from '../../../../scripts/build-wiktionary-redirects'
import { sql } from '../postgres-client'
import { __generateUniqueId } from '../../../test/test-utils'

// The shared test DB is never reset, so every fixture word carries a unique
// suffix — matching is keyed on exact folded strings, so suffixed nonsense
// words are fully isolated from other tests and from each other.
const repository = WiktionaryMatchRepository()

const REAL_LEMMA_DATA = { head_templates: [{ name: 'head' }], senses: [{ glosses: ['test gloss'] }] }

const insertRealLemma = async (lang: string, headword: string, forms: string[] = []): Promise<number> => {
  const [row] = (await sql`
    INSERT INTO public.wiktionary_entries (target_language, headword, pos, data)
    VALUES (${lang}, ${headword}, 'noun', ${sql.json(REAL_LEMMA_DATA)})
    RETURNING id
  `) as [{ id: number }]
  for (const form of forms) {
    await sql`
      INSERT INTO public.wiktionary_forms (target_language, form, entry_id)
      VALUES (${lang}, ${form}, ${row.id})
      ON CONFLICT DO NOTHING
    `
  }
  return row.id
}

const insertStub = async (
  lang: string,
  headword: string,
  kind: 'form_of' | 'alt_of',
  targetWord: string
): Promise<void> => {
  const data = { head_templates: [{ name: 'head' }], senses: [{ [kind]: [{ word: targetWord }] }] }
  await sql`
    INSERT INTO public.wiktionary_entries (target_language, headword, pos, data)
    VALUES (${lang}, ${headword}, 'noun', ${sql.json(data)})
  `
}

describe('wiktionary-match-repository integration tests', () => {
  test('resolves an inflected form to its real lemma', async () => {
    const u = __generateUniqueId('w')
    const lemma = `стол${u}`
    await insertRealLemma('ru', lemma, [`стола${u}`])

    const token = foldCheckpointToken(`Стола́${u}`, 'ru')
    const resolved = await repository.resolveFoldedLemmasForTokens({ targetLanguage: 'ru', foldedTokens: [token] })

    expect(resolved.get(token)).toEqual(new Set([foldCheckpointToken(lemma, 'ru')]))
  })

  test('matches capitalized/ß forms through the fold on both sides', async () => {
    const u = __generateUniqueId('w')
    await insertRealLemma('de', `Straße${u}`, [`Straßen${u}`])

    const token = foldCheckpointToken(`straßen${u}`, 'de')
    expect(token).toBe(`strassen${u}`)
    const resolved = await repository.resolveFoldedLemmasForTokens({ targetLanguage: 'de', foldedTokens: [token] })

    expect(resolved.get(token)).toEqual(new Set([`strasse${u}`]))
  })

  test('matches ё/е in both directions', async () => {
    const u = __generateUniqueId('w')
    // DB side spelled with ё, token spelled with е…
    await insertRealLemma('ru', `ёж${u}`, [`ёжа${u}`])
    // …and DB side spelled with е, token spelled with ё.
    await insertRealLemma('ru', `мед${u}`, [`меда${u}`])

    const tokenE = `ежа${u}`
    const tokenYo = foldCheckpointToken(`мёда${u}`, 'ru')
    const resolved = await repository.resolveFoldedLemmasForTokens({
      targetLanguage: 'ru',
      foldedTokens: [tokenE, tokenYo],
    })

    expect(resolved.get(tokenE)).toEqual(new Set([`еж${u}`]))
    expect(resolved.get(tokenYo)).toEqual(new Set([`мед${u}`]))
  })

  test('a direct headword hit resolves to itself', async () => {
    const u = __generateUniqueId('w')
    const lemma = `дом${u}`
    await insertRealLemma('ru', lemma)

    const resolved = await repository.resolveFoldedLemmasForTokens({ targetLanguage: 'ru', foldedTokens: [lemma] })
    expect(resolved.get(lemma)).toEqual(new Set([lemma]))
  })

  test('an ambiguous form returns ALL candidate lemmas', async () => {
    const u = __generateUniqueId('w')
    const form = `плачу${u}`
    await insertRealLemma('ru', `плакать${u}`, [form])
    await insertRealLemma('ru', `платить${u}`, [form])

    const resolved = await repository.resolveFoldedLemmasForTokens({ targetLanguage: 'ru', foldedTokens: [form] })
    expect(resolved.get(form)).toEqual(new Set([`плакать${u}`, `платить${u}`]))
  })

  test('a stub headword never resolves through the direct arm', async () => {
    const u = __generateUniqueId('w')
    await insertRealLemma('ru', `быть${u}`)
    await insertStub('ru', `есть${u}`, 'form_of', `быть${u}`)

    // No redirects built for this fixture — the stub headword must not match
    // as a lemma in its own right (head_templates alone doesn't make it real).
    const resolved = await repository.resolveFoldedLemmasForTokens({
      targetLanguage: 'ru',
      foldedTokens: [`есть${u}`],
    })
    expect(resolved.has(`есть${u}`)).toBe(false)
  })

  test('language scoping: a token only matches entries of its language', async () => {
    const u = __generateUniqueId('w')
    await insertRealLemma('de', `haus${u}`, [`häuser${u}`])

    const resolved = await repository.resolveFoldedLemmasForTokens({
      targetLanguage: 'en',
      foldedTokens: [`häuser${u}`],
    })
    expect(resolved.size).toBe(0)
  })
})

describe('build-wiktionary-redirects integration tests', () => {
  // The builder DELETEs (standalone mode) an entire language, so these tests
  // run on a unique throwaway language code — per-language ё/ß folding isn't
  // exercised here (that's the parity/unit tests' job), only chain following.
  test('follows form-of and alt-of chains up to 2 hops, drops dead ends', async () => {
    const lang = __generateUniqueId('zz')
    await insertRealLemma(lang, 'dieser')
    await insertStub(lang, 'dieses', 'form_of', 'dieser')
    await insertStub(lang, 'dies', 'alt_of', 'dieses')
    await insertStub(lang, 'orphan', 'form_of', 'missingword')

    await rebuildWiktionaryRedirects(sql, [lang], 'delete')

    const rows = (await sql`
      SELECT folded_form, lemma FROM public.wiktionary_form_redirects
      WHERE target_language = ${lang}
      ORDER BY folded_form
    `) as Array<{ folded_form: string; lemma: string }>
    expect(rows).toEqual([
      { folded_form: 'dies', lemma: 'dieser' },
      { folded_form: 'dieses', lemma: 'dieser' },
    ])

    // And the repository's third arm serves them.
    const resolved = await repository.resolveFoldedLemmasForTokens({
      targetLanguage: lang,
      foldedTokens: ['dies', 'dieses', 'orphan'],
    })
    expect(resolved.get('dies')).toEqual(new Set(['dieser']))
    expect(resolved.get('dieses')).toEqual(new Set(['dieser']))
    expect(resolved.has('orphan')).toBe(false)
  })

  test('rebuilding a language is idempotent', async () => {
    const lang = __generateUniqueId('zz')
    await insertRealLemma(lang, 'target')
    await insertStub(lang, 'variant', 'alt_of', 'target')

    await rebuildWiktionaryRedirects(sql, [lang], 'delete')
    await rebuildWiktionaryRedirects(sql, [lang], 'delete')

    const rows = await sql`
      SELECT folded_form, lemma FROM public.wiktionary_form_redirects WHERE target_language = ${lang}
    `
    expect(rows).toHaveLength(1)
  })
})
