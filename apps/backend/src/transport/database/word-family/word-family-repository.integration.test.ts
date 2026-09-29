import { describe, expect, test } from 'vitest'
import { WordFamilyRepository } from './word-family-repository'
import { KnownLemmasRepository } from '../known-lemmas/known-lemmas-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'

// The shared test DB is never reset: every fixture word carries a random
// Cyrillic suffix, so lookups keyed on exact folded strings are isolated from
// other tests and runs.
const repository = WordFamilyRepository()

const CYRILLIC = 'абвгдежзиклмнопрстуфхцчшщ'
const uniqueSuffix = (): string =>
  Array.from({ length: 10 }, () => CYRILLIC[Math.floor(Math.random() * CYRILLIC.length)]).join('')

const insertEntry = async (headword: string, pos: string, data: object, forms: string[] = []): Promise<void> => {
  const [row] = (await sql`
    INSERT INTO public.wiktionary_entries (target_language, headword, pos, data)
    VALUES ('ru', ${headword}, ${pos}, ${sql.json(data as never)})
    RETURNING id
  `) as [{ id: number }]
  for (const form of forms) {
    await sql`INSERT INTO public.wiktionary_forms (target_language, form, entry_id) VALUES ('ru', ${form}, ${row.id})`
  }
}

const insertEdge = async (lemma: string, relative: string, kind: 'ancestor' | 'related', depth: number) => {
  await sql`
    INSERT INTO public.wiktionary_word_family_edges (target_language, lemma, lemma_pos, relative, kind, depth)
    VALUES ('ru', ${lemma}, 'verb', ${relative}, ${kind}, ${depth})
  `
}

describe('word-family-repository integration tests', () => {
  test('listEntriesForToken returns headword, paradigm and stub hits with their etymology', async () => {
    const u = uniqueSuffix()
    const af = [{ name: 'af', args: { '1': 'ru', '2': 'за-', '3': `мёрзнуть${u}` } }]
    await insertEntry(`замёрзнуть${u}`, 'verb', { head_templates: [{ name: 'ru-verb' }], etymology_templates: af }, [
      `замёрзнет${u}`,
    ])
    await insertEntry(
      `замёрзший${u}`,
      'verb',
      {
        head_templates: [{ name: 'head' }],
        senses: [{ tags: ['participle', 'past'], form_of: [{ word: `замёрзнуть${u}` }], glosses: ['x'] }],
      },
      [`замёрзшие${u}`]
    )

    const byForm = await repository.listEntriesForToken({ targetLanguage: 'ru', foldedToken: `замерзнет${u}` })
    expect(byForm).toEqual([
      {
        headword: `замёрзнуть${u}`,
        folded: `замерзнуть${u}`,
        pos: 'verb',
        isRealLemma: true,
        data: { etymology_templates: af, senses: null },
      },
    ])

    const stub = await repository.listEntriesForToken({ targetLanguage: 'ru', foldedToken: `замерзшие${u}` })
    expect(stub).toHaveLength(1)
    expect(stub[0].isRealLemma).toBe(false)
    expect(stub[0].data.senses).toEqual([{ tags: ['participle', 'past'], form_of: [{ word: `замёрзнуть${u}` }] }])
  })

  test('listLemmaEntries returns only real lemmas of the folded headword', async () => {
    const u = uniqueSuffix()
    await insertEntry(`мёрзнуть${u}`, 'verb', { head_templates: [{ name: 'ru-verb' }] })
    await insertEntry(`мёрзнуть${u}`, 'verb', {
      head_templates: [{ name: 'head' }],
      senses: [{ alt_of: [{ word: 'x' }] }],
    })
    const entries = await repository.listLemmaEntries({ targetLanguage: 'ru', folded: `мерзнуть${u}` })
    expect(entries.map((e) => e.headword)).toEqual([`мёрзнуть${u}`])
  })

  test('listFamilyCandidates returns parents, shared roots (derivatives included) and related words', async () => {
    const u = uniqueSuffix()
    const word = `укрыть${u}`
    const root = `крыть${u}`
    await insertEdge(word, root, 'ancestor', 1)
    // Shares the root with the word.
    await insertEdge(`закрывать${u}`, root, 'ancestor', 2)
    // Derives from the word itself.
    await insertEdge(`укрытие${u}`, word, 'ancestor', 1)
    // Related in both directions.
    await insertEdge(word, `накрыть${u}`, 'related', 1)
    await insertEdge(`покров${u}`, word, 'related', 1)

    const candidates = await repository.listFamilyCandidates({ targetLanguage: 'ru', lemma: word, lemmaPos: ['verb'] })
    const sorted = [...candidates].sort((a, b) => `${a.tier}${a.lemma}`.localeCompare(`${b.tier}${b.lemma}`))
    expect(sorted).toEqual([
      { lemma: root, tier: 'parent', depth: 1 },
      { lemma: `накрыть${u}`, tier: 'related', depth: 1 },
      { lemma: `покров${u}`, tier: 'related', depth: 1 },
      { lemma: `закрывать${u}`, tier: 'shared_root', depth: 3 },
      { lemma: `укрытие${u}`, tier: 'shared_root', depth: 1 },
    ])
  })

  test('listFamilyCandidates drops hidden ancestors and adds extra parents before looking up shared roots', async () => {
    const u = uniqueSuffix()
    const word = `понимать${u}`
    const hidden = `иметь${u}`
    const extra = `нимать${u}`
    await insertEdge(word, hidden, 'ancestor', 1)
    // Would share the hidden root.
    await insertEdge(`снимать${u}`, hidden, 'ancestor', 1)
    // Shares the extra parent.
    await insertEdge(`занимать${u}`, extra, 'ancestor', 1)
    // The hidden ancestor is also a related word; it must not come back.
    await insertEdge(word, hidden, 'related', 1)

    const candidates = await repository.listFamilyCandidates({
      targetLanguage: 'ru',
      lemma: word,
      lemmaPos: ['verb'],
      hiddenAncestors: [hidden],
      extraParents: [extra],
    })
    const sorted = [...candidates].sort((a, b) => `${a.tier}${a.lemma}`.localeCompare(`${b.tier}${b.lemma}`))
    expect(sorted).toEqual([
      { lemma: extra, tier: 'parent', depth: 1 },
      { lemma: `занимать${u}`, tier: 'shared_root', depth: 2 },
    ])
    expect(await repository.listAncestors({ targetLanguage: 'ru', lemma: word, lemmaPos: ['verb'] })).toEqual([hidden])
  })

  test('saveInsight is first-writer-wins and only stores explanations of the stored breakdown', async () => {
    const u = uniqueSuffix()
    const key = { targetLanguage: 'ru', lemma: `ожог${u}`, lemmaPos: 'noun' }
    const parts = [
      { text: 'о-', isAffix: true },
      { text: 'жечь', isAffix: false },
    ]
    expect(await repository.getInsight({ ...key, explanationLanguage: 'en' })).toBeNull()

    const save = (explanationLanguage: string, savedParts: typeof parts, partMeanings: string[]) =>
      repository.saveInsight({
        ...key,
        explanationLanguage,
        parts: savedParts,
        missingParents: ['жечь'],
        hiddenAncestors: [],
        partMeanings,
        cognates: [],
        model: 'm',
      })
    expect(await save('en', parts, ['on a surface', 'burn'])).toBe(true)
    // A concurrent writer with another breakdown loses both halves: its
    // meanings would pair with the wrong parts.
    expect(await save('fr', [{ text: 'ожог', isAffix: false }], ['brûlure'])).toBe(false)
    expect((await repository.getInsight({ ...key, explanationLanguage: 'fr' }))?.explanation).toBeNull()
    // Explaining the stored breakdown succeeds.
    expect(await save('fr', parts, ['sur', 'brûler'])).toBe(true)

    expect(await repository.getInsight({ ...key, explanationLanguage: 'en' })).toEqual({
      parts,
      missingParents: ['жечь'],
      hiddenAncestors: [],
      explanation: { partMeanings: ['on a surface', 'burn'], cognates: [] },
    })
    expect((await repository.getInsight({ ...key, explanationLanguage: 'fr' }))?.explanation).toEqual({
      partMeanings: ['sur', 'brûler'],
      cognates: [],
    })
    expect((await repository.getInsight({ ...key, explanationLanguage: 'de' }))?.explanation).toBeNull()
  })

  test('listUserVocabulary reports known marks, live saved terms and ranks', async () => {
    const u = uniqueSuffix()
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    await KnownLemmasRepository().bulkMarkKnown({
      userId,
      targetLanguage: 'ru',
      lemmas: [`крыть${u}`, `рыть${u}`],
      source: 'bulk_text',
      sourceId: null,
      sweepBatchId: null,
    })
    await sql`
      INSERT INTO public.user_lookups (user_id, target_language, headword, sense, count)
      VALUES (${userId}, 'ru', ${`рыть${u}`}, '', 1), (${userId}, 'ru', ${`мыть${u}`}, '', 1)
    `
    await sql`
      INSERT INTO public.user_lookups (user_id, target_language, headword, sense, count, deleted_at)
      VALUES (${userId}, 'ru', ${`шить${u}`}, '', 1, NOW())
    `
    await sql`INSERT INTO public.lemma_ranks (target_language, lemma, rank, freq_mass) VALUES ('ru', ${`крыть${u}`}, 4242, 0.1)`

    const rows = await repository.listUserVocabulary({
      userId,
      targetLanguage: 'ru',
      lemmas: [`крыть${u}`, `рыть${u}`, `мыть${u}`, `шить${u}`, `бить${u}`],
    })
    expect([...rows].sort((a, b) => a.lemma.localeCompare(b.lemma))).toEqual(
      [
        { lemma: `крыть${u}`, known: true, saved: false, rank: 4242 },
        { lemma: `мыть${u}`, known: false, saved: true, rank: null },
        { lemma: `рыть${u}`, known: true, saved: true, rank: null },
      ].sort((a, b) => a.lemma.localeCompare(b.lemma))
    )
  })
})
