import { describe, expect, it } from 'vitest'
import { DE_CASE_TWIN_DISCOUNT, checkAcceptance, isRealWordToken, rankLemmas, splitFormMass } from './build-ranking'

describe('isRealWordToken', () => {
  it('accepts plain and hyphenated words of the language script', () => {
    expect(isRealWordToken('стол', 'ru')).toBe(true)
    expect(isRealWordToken('кто-то', 'ru')).toBe(true)
    expect(isRealWordToken('haus', 'de')).toBe(true)
    expect(isRealWordToken('äugen', 'de')).toBe(true)
    expect(isRealWordToken("don't", 'en')).toBe(true)
    expect(isRealWordToken('well-being', 'en')).toBe(true)
    expect(isRealWordToken('más', 'es')).toBe(true)
    expect(isRealWordToken('niño', 'es')).toBe(true)
    expect(isRealWordToken('vergüenza', 'es')).toBe(true)
    expect(isRealWordToken('coração', 'pt')).toBe(true)
    expect(isRealWordToken('queixar-se', 'pt')).toBe(true)
    expect(isRealWordToken('você', 'pt')).toBe(true)
  })

  it('keeps single-letter words (one-letter function words are real)', () => {
    expect(isRealWordToken('в', 'ru')).toBe(true)
    expect(isRealWordToken('a', 'en')).toBe(true)
  })

  it('rejects digits, symbols, mixed script, and latin loans in ru', () => {
    expect(isRealWordToken('2020', 'ru')).toBe(false)
    expect(isRealWordToken('ok', 'ru')).toBe(false)
    expect(isRealWordToken('стол2', 'ru')).toBe(false)
    expect(isRealWordToken('c++', 'en')).toBe(false)
    expect(isRealWordToken('-', 'de')).toBe(false)
    expect(isRealWordToken('', 'de')).toBe(false)
    expect(isRealWordToken('año2', 'es')).toBe(false)
    expect(isRealWordToken('стол', 'es')).toBe(false)
    expect(isRealWordToken('são-', 'pt')).toBe(false)
  })

  it('throws on a language without a pattern', () => {
    expect(() => isRealWordToken('mot', 'fr')).toThrow(/no real-word-token pattern/i)
  })
})

describe('splitFormMass', () => {
  const freq =
    (table: Record<string, number>) =>
    (lemma: string): number | undefined =>
      table[lemma]

  it('gives an unambiguous form all its mass', () => {
    const split = splitFormMass({
      formFrequency: 0.01,
      candidates: [{ lemma: 'идти', foldedLemma: 'идти' }],
      targetLanguage: 'ru',
      frequencyOfFoldedLemma: freq({ идти: 0.001 }),
      epsilonWeight: 1e-9,
    })
    expect(split.get('идти')).toBeCloseTo(0.01)
  })

  it('splits ambiguous mass by candidate corpus frequency, never evenly', () => {
    // The spike's ру кака/как case: even splitting would give кака half of
    // как's enormous mass.
    const split = splitFormMass({
      formFrequency: 0.02,
      candidates: [
        { lemma: 'как', foldedLemma: 'как' },
        { lemma: 'кака', foldedLemma: 'кака' },
      ],
      targetLanguage: 'ru',
      frequencyOfFoldedLemma: freq({ как: 0.0199, кака: 0.0000001 }),
      epsilonWeight: 1e-9,
    })
    const total = [...split.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(0.02)
    expect(split.get('как')! / split.get('кака')!).toBeGreaterThan(1000)
  })

  it('falls back to the epsilon weight for lemmas wordfreq does not list', () => {
    const split = splitFormMass({
      formFrequency: 0.01,
      candidates: [
        { lemma: 'gehen', foldedLemma: 'gehen' },
        { lemma: 'gehnix', foldedLemma: 'gehnix' },
      ],
      targetLanguage: 'de',
      frequencyOfFoldedLemma: freq({ gehen: 0.001 }),
      epsilonWeight: 1e-9,
    })
    expect(split.get('gehnix')).toBeGreaterThan(0)
    expect(split.get('gehen')! / split.get('gehnix')!).toBeCloseTo(0.001 / 1e-9, -2)
  })

  it('discounts a German capitalized lemma when its lowercase twin competes', () => {
    // wordfreq is caseless: Auch (town) and auch (adverb) both look up the
    // same frequency and would split 50/50 without the discount.
    const split = splitFormMass({
      formFrequency: 0.03,
      candidates: [
        { lemma: 'Auch', foldedLemma: 'auch-town' },
        { lemma: 'auch', foldedLemma: 'auch' },
      ],
      targetLanguage: 'de',
      frequencyOfFoldedLemma: freq({ auch: 0.01, 'auch-town': 0.01 }),
      epsilonWeight: 1e-9,
    })
    expect(split.get('auch')! / split.get('auch-town')!).toBeCloseTo(1 / DE_CASE_TWIN_DISCOUNT)
  })

  it('does not discount a capitalized lemma without a competing twin', () => {
    const split = splitFormMass({
      formFrequency: 0.01,
      candidates: [
        { lemma: 'Haus', foldedLemma: 'haus' },
        { lemma: 'hausen', foldedLemma: 'hausen' },
      ],
      targetLanguage: 'de',
      frequencyOfFoldedLemma: freq({ haus: 0.004, hausen: 0.004 }),
      epsilonWeight: 1e-9,
    })
    expect(split.get('haus')).toBeCloseTo(split.get('hausen')!)
  })

  it('never applies the case-twin discount outside German', () => {
    const split = splitFormMass({
      formFrequency: 0.01,
      candidates: [
        { lemma: 'March', foldedLemma: 'march-month' },
        { lemma: 'march', foldedLemma: 'march' },
      ],
      targetLanguage: 'en',
      frequencyOfFoldedLemma: freq({ march: 0.001, 'march-month': 0.001 }),
      epsilonWeight: 1e-9,
    })
    expect(split.get('march')).toBeCloseTo(split.get('march-month')!)
  })

  it('pools same-fold candidates under one key with the full mass', () => {
    // de sein (verb) + Sein (noun) fold to one canonical lemma key.
    const split = splitFormMass({
      formFrequency: 0.05,
      candidates: [
        { lemma: 'sein', foldedLemma: 'sein' },
        { lemma: 'Sein', foldedLemma: 'sein' },
      ],
      targetLanguage: 'de',
      frequencyOfFoldedLemma: freq({ sein: 0.01 }),
      epsilonWeight: 1e-9,
    })
    expect(split.size).toBe(1)
    expect(split.get('sein')).toBeCloseTo(0.05)
  })

  it('conserves mass exactly across any split', () => {
    const split = splitFormMass({
      formFrequency: 0.007,
      candidates: [
        { lemma: 'сталь', foldedLemma: 'сталь' },
        { lemma: 'стать', foldedLemma: 'стать' },
        { lemma: 'стать2', foldedLemma: 'стать2' },
      ],
      targetLanguage: 'ru',
      frequencyOfFoldedLemma: freq({ сталь: 0.0001, стать: 0.001 }),
      epsilonWeight: 1e-9,
    })
    const total = [...split.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(0.007)
  })

  it('returns empty for zero mass or no candidates', () => {
    expect(
      splitFormMass({
        formFrequency: 0,
        candidates: [{ lemma: 'x', foldedLemma: 'x' }],
        targetLanguage: 'en',
        frequencyOfFoldedLemma: () => undefined,
        epsilonWeight: 1e-9,
      }).size
    ).toBe(0)
    expect(
      splitFormMass({
        formFrequency: 0.01,
        candidates: [],
        targetLanguage: 'en',
        frequencyOfFoldedLemma: () => undefined,
        epsilonWeight: 1e-9,
      }).size
    ).toBe(0)
  })
})

describe('rankLemmas', () => {
  it('ranks by mass descending with deterministic tie-break', () => {
    const ranked = rankLemmas(
      new Map([
        ['b', 0.5],
        ['a', 0.5],
        ['c', 0.9],
        ['zero', 0],
      ])
    )
    expect(ranked).toEqual([
      { lemma: 'c', rank: 1, freqMass: 0.9 },
      { lemma: 'a', rank: 2, freqMass: 0.5 },
      { lemma: 'b', rank: 3, freqMass: 0.5 },
    ])
  })

  it('drops lemmas below the mass floor and renumbers ranks contiguously', () => {
    // Epsilon-plateau shape: dust masses just under the floor, one real lemma
    // above it, one exactly at it (a floor is inclusive — "at least the
    // rarest measurable form").
    const ranked = rankLemmas(
      new Map([
        ['real', 0.5],
        ['at-floor', 1e-7],
        ['dust-a', 9.12e-9],
        ['dust-b', 9.11e-9],
      ]),
      1e-7
    )
    expect(ranked).toEqual([
      { lemma: 'real', rank: 1, freqMass: 0.5 },
      { lemma: 'at-floor', rank: 2, freqMass: 1e-7 },
    ])
  })

  it('keeps a sole-candidate lemma whose inherited full form mass clears the floor', () => {
    // An unlisted lemma that fully owns a listed form gets the form's whole
    // mass — legitimate, and it must survive the floor.
    const split = splitFormMass({
      formFrequency: 2e-7,
      candidates: [{ lemma: 'musth', foldedLemma: 'musth' }],
      targetLanguage: 'en',
      frequencyOfFoldedLemma: () => undefined,
      epsilonWeight: 1e-8,
    })
    const ranked = rankLemmas(split, 1e-7)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].lemma).toBe('musth')
    expect(ranked[0].rank).toBe(1)
    expect(ranked[0].freqMass).toBeCloseTo(2e-7, 12)
  })

  it('keeps every positive-mass lemma when no floor is given', () => {
    const ranked = rankLemmas(
      new Map([
        ['real', 0.5],
        ['dust', 9.12e-9],
      ])
    )
    expect(ranked).toHaveLength(2)
  })
})

describe('checkAcceptance', () => {
  it('passes the spike-shaped result', () => {
    const result = checkAcceptance({
      totalWordTokenMass: 1,
      matchedWordTokenMass: 0.976,
      lemmaCount: 16_000,
    })
    expect(result.massMatchedPct).toBeCloseTo(97.6)
    expect(result.failures).toEqual([])
  })

  it('fails on low mass match and out-of-bounds denominators', () => {
    expect(
      checkAcceptance({ totalWordTokenMass: 1, matchedWordTokenMass: 0.9, lemmaCount: 16_000 }).failures
    ).toHaveLength(1)
    expect(
      checkAcceptance({ totalWordTokenMass: 1, matchedWordTokenMass: 0.99, lemmaCount: 100 }).failures
    ).toHaveLength(1)
    expect(
      checkAcceptance({ totalWordTokenMass: 1, matchedWordTokenMass: 0.99, lemmaCount: 300_000 }).failures
    ).toHaveLength(1)
    expect(checkAcceptance({ totalWordTokenMass: 0, matchedWordTokenMass: 0, lemmaCount: 0 }).failures.length).toBe(2)
  })
})
