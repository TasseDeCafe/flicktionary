import { describe, expect, test } from 'vitest'
import type { WordFamilyEntry } from '../../transport/database/word-family/word-family-repository'
import { MAX_ANCHORS, pickFamilyEntries, rankAnchors } from './word-family'

const lemmaEntry = (folded: string, pos: string, parts?: string[]): WordFamilyEntry => ({
  headword: folded,
  folded,
  pos,
  isRealLemma: true,
  data: parts
    ? {
        etymology_templates: [
          { name: 'af', args: Object.fromEntries([['1', 'ru'], ...parts.map((p, i) => [String(i + 2), p])]) },
        ],
      }
    : {},
})

const participleStub = (folded: string, target: string): WordFamilyEntry => ({
  headword: folded,
  folded,
  pos: 'verb',
  isRealLemma: false,
  data: { senses: [{ tags: ['active', 'form-of', 'participle', 'past'], form_of: [{ word: target }] }] },
})

const inflectionStub = (folded: string, target: string): WordFamilyEntry => ({
  headword: folded,
  folded,
  pos: 'noun',
  isRealLemma: false,
  data: { senses: [{ tags: ['form-of', 'genitive'], form_of: [{ word: target }] }] },
})

describe('pickFamilyEntries', () => {
  test('a participle stub beats its own verb', () => {
    const picked = pickFamilyEntries(
      [lemmaEntry('замерзнуть', 'verb', ['за-', 'мёрзнуть']), participleStub('замерзший', 'замёрзнуть')],
      'замерзшие',
      null,
      'ru'
    )
    expect(picked?.folded).toBe('замерзший')
  })

  test('a headword that is the token beats its aspect partner listed in paradigms', () => {
    const picked = pickFamilyEntries(
      [lemmaEntry('угасать', 'verb', ['угаснуть', '-ать']), lemmaEntry('угаснуть', 'verb', ['у-', 'гаснуть'])],
      'угасать',
      'verb',
      'ru'
    )
    expect(picked?.folded).toBe('угасать')
  })

  test('the gloss POS wins over a direct headword hit', () => {
    // стекло is the noun "glass" and a past form of стечь.
    const entries = [lemmaEntry('стекло', 'noun'), lemmaEntry('стечь', 'verb')]
    expect(pickFamilyEntries(entries, 'стекло', 'verb', 'ru')?.folded).toBe('стечь')
    expect(pickFamilyEntries(entries, 'стекло', 'noun', 'ru')?.folded).toBe('стекло')
    expect(pickFamilyEntries(entries, 'стекло', null, 'ru')?.folded).toBe('стекло')
  })

  test('the gloss POS breaks homograph ties', () => {
    const entries = [lemmaEntry('стать', 'verb'), lemmaEntry('сталь', 'noun')]
    expect(pickFamilyEntries(entries, 'стали', 'noun', 'ru')?.folded).toBe('сталь')
    expect(pickFamilyEntries(entries, 'стали', 'verb', 'ru')?.folded).toBe('стать')
  })

  test('unresolved homographs get no family line', () => {
    expect(
      pickFamilyEntries([lemmaEntry('стать', 'verb'), lemmaEntry('сталь', 'noun')], 'стали', null, 'ru')
    ).toBeNull()
  })

  test('a POS matching nothing falls back to every usable entry', () => {
    expect(pickFamilyEntries([lemmaEntry('замерзнуть', 'verb')], 'замерзнет', 'adj', 'ru')?.folded).toBe('замерзнуть')
  })

  test('plain inflection stubs are ignored', () => {
    expect(pickFamilyEntries([inflectionStub('стали', 'сталь')], 'стали', null, 'ru')).toBeNull()
    expect(
      pickFamilyEntries([inflectionStub('стали', 'сталь'), lemmaEntry('стать', 'verb')], 'стали', null, 'ru')?.folded
    ).toBe('стать')
  })

  test('keeps every POS row of the chosen headword', () => {
    const picked = pickFamilyEntries(
      [lemmaEntry('жареный', 'adj'), participleStub('жареный', 'жарить')],
      'жареный',
      null,
      'ru'
    )
    expect(picked?.entries.map((e) => e.pos).sort()).toEqual(['adj', 'verb'])
  })
})

describe('rankAnchors', () => {
  test('orders by tier, then known before saved, then frequency', () => {
    const ranked = rankAnchors(
      [
        { lemma: 'рука', tier: 'related', depth: 1 },
        { lemma: 'мерзнуть', tier: 'parent', depth: 1 },
        { lemma: 'закрываться', tier: 'shared_root', depth: 4 },
        { lemma: 'покрывать', tier: 'shared_root', depth: 2 },
        { lemma: 'открываться', tier: 'shared_root', depth: 4 },
      ],
      [
        { lemma: 'рука', known: true, saved: false, rank: 50 },
        { lemma: 'мерзнуть', known: false, saved: true, rank: 9000 },
        { lemma: 'закрываться', known: false, saved: true, rank: 3000 },
        { lemma: 'покрывать', known: true, saved: false, rank: 5000 },
        { lemma: 'открываться', known: true, saved: false, rank: 2000 },
      ],
      new Set()
    )
    expect(ranked).toEqual([
      { lemma: 'мерзнуть', source: 'saved', tier: 'parent' },
      { lemma: 'открываться', source: 'known', tier: 'shared_root' },
      { lemma: 'покрывать', source: 'known', tier: 'shared_root' },
    ])
    expect(ranked).toHaveLength(MAX_ANCHORS)
  })

  test('a member keeps its best tier; the word itself is never its own anchor', () => {
    const ranked = rankAnchors(
      [
        { lemma: 'крыть', tier: 'shared_root', depth: 2 },
        { lemma: 'крыть', tier: 'parent', depth: 1 },
        { lemma: 'укрыть', tier: 'shared_root', depth: 0 },
      ],
      [
        { lemma: 'крыть', known: true, saved: false, rank: null },
        { lemma: 'укрыть', known: true, saved: false, rank: 10 },
      ],
      new Set(['укрыть'])
    )
    expect(ranked).toEqual([{ lemma: 'крыть', source: 'known', tier: 'parent' }])
  })

  test('a saved term beats a known mark for the same lemma', () => {
    const ranked = rankAnchors(
      [{ lemma: 'резать', tier: 'parent', depth: 2 }],
      [{ lemma: 'резать', known: true, saved: true, rank: 100 }],
      new Set()
    )
    expect(ranked[0].source).toBe('saved')
  })
})
