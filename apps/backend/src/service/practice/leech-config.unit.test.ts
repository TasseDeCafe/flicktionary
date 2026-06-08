import { describe, expect, it } from 'vitest'
import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'
import type { FsrsResult } from './fsrs'
import { LEECH_LAPSE_THRESHOLD, isParked, shouldParkLeech } from './leech-config'

const makeFacetRow = (overrides: Partial<DbUserLookupWithFacet> = {}): DbUserLookupWithFacet =>
  ({
    id: '00000000-0000-0000-0000-000000000004',
    user_id: '00000000-0000-0000-0000-000000000001',
    target_language: 'es',
    headword: 'gato',
    sense: 'cat',
    learning_mode: 'passive',
    skill: 'meaning_recognition',
    target_form: '',
    srs_state: 'review',
    srs_due: null,
    srs_stability: null,
    srs_difficulty: null,
    srs_last_review: null,
    srs_reps: 0,
    srs_lapses: 0,
    leech_parked_at: null,
    leech_rehab_correct_days: 0,
    leech_rehab_last_correct_on: null,
    introduced_at: null,
    ...overrides,
  }) as DbUserLookupWithFacet

const makeResult = (lapses: number): FsrsResult => ({
  state: 'relearning',
  due: new Date('2026-06-05T00:00:00Z'),
  stability: 1,
  difficulty: 6,
  lastReview: new Date('2026-06-04T00:00:00Z'),
  reps: 10,
  lapses,
})

describe('shouldParkLeech', () => {
  it('parks on a fresh lapse that reaches the threshold', () => {
    const facet = makeFacetRow({ srs_lapses: LEECH_LAPSE_THRESHOLD - 1 })
    expect(shouldParkLeech(facet, makeResult(LEECH_LAPSE_THRESHOLD))).toBe(true)
  })

  it('parks on a fresh lapse beyond the threshold (graduated facet lapsing again)', () => {
    const facet = makeFacetRow({ srs_lapses: 6 })
    expect(shouldParkLeech(facet, makeResult(7))).toBe(true)
  })

  it('does NOT park below the threshold even on a fresh lapse', () => {
    const facet = makeFacetRow({ srs_lapses: 1 })
    expect(shouldParkLeech(facet, makeResult(2))).toBe(false)
  })

  it('does NOT park without a new lapse, regardless of historical lapses (good/easy on a graduated facet)', () => {
    // After graduation lapses stay >= threshold forever; an absolute check
    // would re-park on the very next rating. The delta condition must not.
    const facet = makeFacetRow({ srs_lapses: 5 })
    expect(shouldParkLeech(facet, makeResult(5))).toBe(false)
  })

  it('does NOT park a facet already parked', () => {
    const facet = makeFacetRow({ srs_lapses: 4, leech_parked_at: '2026-06-01T00:00:00Z' })
    expect(shouldParkLeech(facet, makeResult(5))).toBe(false)
  })

  it('reads the production facet just the same (the facet encodes the pool)', () => {
    const facet = makeFacetRow({ skill: 'meaning_production', srs_lapses: LEECH_LAPSE_THRESHOLD - 1 })
    expect(shouldParkLeech(facet, makeResult(LEECH_LAPSE_THRESHOLD))).toBe(true)
  })
})

describe('isParked', () => {
  it('reads the facet parked flag', () => {
    expect(isParked(makeFacetRow({ leech_parked_at: '2026-06-01T00:00:00Z' }))).toBe(true)
    expect(isParked(makeFacetRow({ leech_parked_at: null }))).toBe(false)
  })
})
