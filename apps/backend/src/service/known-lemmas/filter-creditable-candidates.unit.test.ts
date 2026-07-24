import { describe, expect, it } from 'vitest'
import { filterCreditableCandidates } from './filter-creditable-candidates'

const tokenMap = (entries: Record<string, string[]>): Map<string, Set<string>> =>
  new Map(Object.entries(entries).map(([token, lemmas]) => [token, new Set(lemmas)]))

describe('filterCreditableCandidates', () => {
  it('drops unranked candidates when the token has a ranked one', () => {
    const filtered = filterCreditableCandidates({
      lemmasByToken: tokenMap({ because: ['because', 'becuz'], five: ['five', 'mi5'] }),
      rankedLemmas: new Set(['because', 'five']),
    })
    expect(filtered.get('because')).toEqual(new Set(['because']))
    expect(filtered.get('five')).toEqual(new Set(['five']))
  })

  it('keeps all candidates of a token with no ranked candidate', () => {
    // Sole-owner rare real words ("musth" appearing as itself) must stay
    // creditable so difficulty keeps working.
    const filtered = filterCreditableCandidates({
      lemmasByToken: tokenMap({ musth: ['musth', 'musthx'] }),
      rankedLemmas: new Set(['unrelated']),
    })
    expect(filtered.get('musth')).toEqual(new Set(['musth', 'musthx']))
  })

  it('keeps genuine ranked homographs side by side', () => {
    const filtered = filterCreditableCandidates({
      lemmasByToken: tokenMap({ bear: ['bear', 'bere'] }),
      rankedLemmas: new Set(['bear', 'bere']),
    })
    expect(filtered.get('bear')).toEqual(new Set(['bear', 'bere']))
  })

  it('always drops multi-word candidates and omits tokens left empty', () => {
    const filtered = filterCreditableCandidates({
      lemmasByToken: tokenMap({ gonna: ['going to'], run: ['run', 'run out'] }),
      rankedLemmas: new Set(['run']),
    })
    expect(filtered.has('gonna')).toBe(false)
    expect(filtered.get('run')).toEqual(new Set(['run']))
  })

  it('passes everything through for a language without ranks', () => {
    const lemmasByToken = tokenMap({ дом: ['дом', 'дома'], кот: ['кот'] })
    const filtered = filterCreditableCandidates({ lemmasByToken, rankedLemmas: new Set() })
    expect(filtered).toEqual(lemmasByToken)
  })
})
