import { describe, expect, it } from 'vitest'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import type { FsrsResult } from './fsrs'
import { LEECH_LAPSE_THRESHOLD, isParked, shouldParkLeech } from './leech-config'

const makeLookup = (overrides: Partial<DbUserLookup> = {}): DbUserLookup =>
  ({
    id: '00000000-0000-0000-0000-000000000004',
    user_id: '00000000-0000-0000-0000-000000000001',
    target_language: 'es',
    headword: 'gato',
    sense: 'cat',
    srs_state: 'review',
    srs_lapses: 0,
    active_srs_state: null,
    active_srs_lapses: 0,
    leech_parked_at: null,
    leech_rehab_correct_days: 0,
    leech_rehab_last_correct_on: null,
    active_leech_parked_at: null,
    active_leech_rehab_correct_days: 0,
    active_leech_rehab_last_correct_on: null,
    ...overrides,
  }) as DbUserLookup

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
    const lookup = makeLookup({ srs_lapses: LEECH_LAPSE_THRESHOLD - 1 })
    expect(shouldParkLeech(lookup, makeResult(LEECH_LAPSE_THRESHOLD), 'passive')).toBe(true)
  })

  it('parks on a fresh lapse beyond the threshold (graduated term lapsing again)', () => {
    const lookup = makeLookup({ srs_lapses: 6 })
    expect(shouldParkLeech(lookup, makeResult(7), 'passive')).toBe(true)
  })

  it('does NOT park below the threshold even on a fresh lapse', () => {
    const lookup = makeLookup({ srs_lapses: 1 })
    expect(shouldParkLeech(lookup, makeResult(2), 'passive')).toBe(false)
  })

  it('does NOT park without a new lapse, regardless of historical lapses (good/easy on a graduated term)', () => {
    // After graduation lapses stay >= threshold forever; an absolute check
    // would re-park on the very next rating. The delta condition must not.
    const lookup = makeLookup({ srs_lapses: 5 })
    expect(shouldParkLeech(lookup, makeResult(5), 'passive')).toBe(false)
  })

  it('does NOT park a term already parked in this pool', () => {
    const lookup = makeLookup({ srs_lapses: 4, leech_parked_at: '2026-06-01T00:00:00Z' })
    expect(shouldParkLeech(lookup, makeResult(5), 'passive')).toBe(false)
  })

  it('reads the active column family for the active pool', () => {
    const lookup = makeLookup({ active_srs_lapses: LEECH_LAPSE_THRESHOLD - 1 })
    expect(shouldParkLeech(lookup, makeResult(LEECH_LAPSE_THRESHOLD), 'active')).toBe(true)
  })

  it('active pool parking is independent of the passive parked flag', () => {
    const lookup = makeLookup({
      leech_parked_at: '2026-06-01T00:00:00Z',
      active_srs_lapses: LEECH_LAPSE_THRESHOLD - 1,
    })
    expect(shouldParkLeech(lookup, makeResult(LEECH_LAPSE_THRESHOLD), 'active')).toBe(true)
  })
})

describe('isParked', () => {
  it('selects the column family by pool', () => {
    const lookup = makeLookup({ leech_parked_at: '2026-06-01T00:00:00Z' })
    expect(isParked(lookup, 'passive')).toBe(true)
    expect(isParked(lookup, 'active')).toBe(false)
  })
})
