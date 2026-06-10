import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'
import { SOFT_REENTRY_DIFFICULTY, SOFT_REENTRY_STABILITY } from './leech-config'
import { applyGateAnswer, gateTypeForTier, type RehabDependencies } from './rehab'

const lookupId = '00000000-0000-0000-0000-000000000004'

const makeParkedFacet = (overrides: Partial<DbUserLookupWithFacet> = {}): DbUserLookupWithFacet =>
  ({
    id: lookupId,
    user_id: '00000000-0000-0000-0000-000000000001',
    target_language: 'es',
    headword: 'gato',
    sense: 'cat',
    skill: 'meaning_recognition',
    target_form: '',
    srs_state: 'relearning',
    srs_lapses: 4,
    leech_parked_at: '2026-06-01T00:00:00Z',
    leech_rehab_correct_days: 0,
    leech_rehab_last_correct_on: null,
    introduced_at: null,
    ...overrides,
  }) as DbUserLookupWithFacet

const createDeps = () => {
  const advanceRehabDayFacet = vi.fn()
  const unparkAndSoftReentryFacet = vi.fn().mockResolvedValue(undefined)
  const deps = {
    studyFacetsRepository: { advanceRehabDayFacet, unparkAndSoftReentryFacet },
  } as unknown as RehabDependencies
  return { deps, advanceRehabDayFacet, unparkAndSoftReentryFacet }
}

describe('gateTypeForTier', () => {
  it('escalates the recognition ladder: mc_cloze -> mc_comprehension -> mc_cloze (fresh)', () => {
    expect(gateTypeForTier('recognition', 0)).toBe('mc_cloze')
    expect(gateTypeForTier('recognition', 1)).toBe('mc_comprehension')
    expect(gateTypeForTier('recognition', 2)).toBe('mc_cloze')
  })

  it('escalates the production ladder: mc_cloze -> production_cloze -> production_cloze (fresh)', () => {
    expect(gateTypeForTier('production', 0)).toBe('mc_cloze')
    expect(gateTypeForTier('production', 1)).toBe('production_cloze')
    expect(gateTypeForTier('production', 2)).toBe('production_cloze')
  })

  it('clamps out-of-range tiers to the ladder bounds', () => {
    expect(gateTypeForTier('recognition', 7)).toBe('mc_cloze')
    expect(gateTypeForTier('production', -1)).toBe('mc_cloze')
  })
})

describe('applyGateAnswer', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('no-ops for a facet that is not parked', async () => {
    const { deps, advanceRehabDayFacet, unparkAndSoftReentryFacet } = createDeps()
    const outcome = await applyGateAnswer({
      lookup: makeParkedFacet({ leech_parked_at: null }),
      pool: 'recognition',
      correct: true,
      deps,
    })
    expect(outcome).toEqual({ rehabCorrectDays: null, graduated: false })
    expect(advanceRehabDayFacet).not.toHaveBeenCalled()
    expect(unparkAndSoftReentryFacet).not.toHaveBeenCalled()
  })

  it('an incorrect answer consumes the attempt but never advances', async () => {
    const { deps, advanceRehabDayFacet } = createDeps()
    const outcome = await applyGateAnswer({
      lookup: makeParkedFacet({ leech_rehab_correct_days: 1 }),
      pool: 'recognition',
      correct: false,
      deps,
    })
    expect(outcome).toEqual({ rehabCorrectDays: 1, graduated: false })
    expect(advanceRehabDayFacet).not.toHaveBeenCalled()
  })

  it('a correct answer advances one day (below the graduation threshold)', async () => {
    const { deps, advanceRehabDayFacet, unparkAndSoftReentryFacet } = createDeps()
    advanceRehabDayFacet.mockResolvedValue(1)
    const outcome = await applyGateAnswer({ lookup: makeParkedFacet(), pool: 'recognition', correct: true, deps })
    expect(outcome).toEqual({ rehabCorrectDays: 1, graduated: false })
    expect(advanceRehabDayFacet).toHaveBeenCalledWith({
      userLookupId: lookupId,
      skill: 'meaning_recognition',
      targetForm: '',
    })
    expect(unparkAndSoftReentryFacet).not.toHaveBeenCalled()
  })

  it('a second same-day correct answer does not double-advance (repo guard returns null)', async () => {
    const { deps, advanceRehabDayFacet, unparkAndSoftReentryFacet } = createDeps()
    advanceRehabDayFacet.mockResolvedValue(null) // already credited today
    const outcome = await applyGateAnswer({
      lookup: makeParkedFacet({ leech_rehab_correct_days: 1 }),
      pool: 'recognition',
      correct: true,
      deps,
    })
    expect(outcome).toEqual({ rehabCorrectDays: 1, graduated: false })
    expect(unparkAndSoftReentryFacet).not.toHaveBeenCalled()
  })

  it('graduates at the threshold via one-shot soft re-entry with the softened schedule', async () => {
    const { deps, advanceRehabDayFacet, unparkAndSoftReentryFacet } = createDeps()
    advanceRehabDayFacet.mockResolvedValue(3)
    const outcome = await applyGateAnswer({
      lookup: makeParkedFacet({ leech_rehab_correct_days: 2 }),
      pool: 'recognition',
      correct: true,
      deps,
    })
    expect(outcome).toEqual({ rehabCorrectDays: 3, graduated: true })
    expect(unparkAndSoftReentryFacet).toHaveBeenCalledWith(
      expect.objectContaining({
        userLookupId: lookupId,
        skill: 'meaning_recognition',
        targetForm: '',
        state: 'review',
        stability: SOFT_REENTRY_STABILITY,
        difficulty: SOFT_REENTRY_DIFFICULTY,
      })
    )
  })

  it('addresses the production facet for the production pool', async () => {
    const { deps, advanceRehabDayFacet } = createDeps()
    advanceRehabDayFacet.mockResolvedValue(1)
    const lookup = makeParkedFacet({ skill: 'meaning_production' })
    const outcome = await applyGateAnswer({ lookup, pool: 'production', correct: true, deps })
    expect(outcome).toEqual({ rehabCorrectDays: 1, graduated: false })
    expect(advanceRehabDayFacet).toHaveBeenCalledWith({
      userLookupId: lookupId,
      skill: 'meaning_production',
      targetForm: '',
    })
  })
})
