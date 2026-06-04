import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import { SOFT_REENTRY_DIFFICULTY, SOFT_REENTRY_STABILITY } from './leech-config'
import { applyGateAnswer, gateTypeForTier, type RehabDependencies } from './rehab'

const lookupId = '00000000-0000-0000-0000-000000000004'

const makeParkedLookup = (overrides: Partial<DbUserLookup> = {}): DbUserLookup =>
  ({
    id: lookupId,
    user_id: '00000000-0000-0000-0000-000000000001',
    target_language: 'es',
    headword: 'gato',
    sense: 'cat',
    learning_mode: 'passive',
    srs_lapses: 4,
    active_srs_lapses: 0,
    leech_parked_at: '2026-06-01T00:00:00Z',
    leech_rehab_correct_days: 0,
    leech_rehab_last_correct_on: null,
    active_leech_parked_at: null,
    active_leech_rehab_correct_days: 0,
    active_leech_rehab_last_correct_on: null,
    ...overrides,
  }) as DbUserLookup

const createDeps = () => {
  const advanceRehabDay = vi.fn()
  const unparkAndSoftReentry = vi.fn().mockResolvedValue(undefined)
  const deps = {
    userLookupsRepository: { advanceRehabDay, unparkAndSoftReentry },
  } as unknown as RehabDependencies
  return { deps, advanceRehabDay, unparkAndSoftReentry }
}

describe('gateTypeForTier', () => {
  it('escalates the passive ladder: mc_cloze -> mc_comprehension -> mc_cloze (fresh)', () => {
    expect(gateTypeForTier('passive', 0)).toBe('mc_cloze')
    expect(gateTypeForTier('passive', 1)).toBe('mc_comprehension')
    expect(gateTypeForTier('passive', 2)).toBe('mc_cloze')
  })

  it('escalates the active ladder: mc_cloze -> production_cloze -> production_cloze (fresh)', () => {
    expect(gateTypeForTier('active', 0)).toBe('mc_cloze')
    expect(gateTypeForTier('active', 1)).toBe('production_cloze')
    expect(gateTypeForTier('active', 2)).toBe('production_cloze')
  })

  it('clamps out-of-range tiers to the ladder bounds', () => {
    expect(gateTypeForTier('passive', 7)).toBe('mc_cloze')
    expect(gateTypeForTier('active', -1)).toBe('mc_cloze')
  })
})

describe('applyGateAnswer', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('no-ops for a term not parked in this pool', async () => {
    const { deps, advanceRehabDay, unparkAndSoftReentry } = createDeps()
    const outcome = await applyGateAnswer({
      lookup: makeParkedLookup({ leech_parked_at: null }),
      pool: 'passive',
      correct: true,
      deps,
    })
    expect(outcome).toEqual({ rehabCorrectDays: null, graduated: false })
    expect(advanceRehabDay).not.toHaveBeenCalled()
    expect(unparkAndSoftReentry).not.toHaveBeenCalled()
  })

  it('an incorrect answer consumes the attempt but never advances', async () => {
    const { deps, advanceRehabDay } = createDeps()
    const outcome = await applyGateAnswer({
      lookup: makeParkedLookup({ leech_rehab_correct_days: 1 }),
      pool: 'passive',
      correct: false,
      deps,
    })
    expect(outcome).toEqual({ rehabCorrectDays: 1, graduated: false })
    expect(advanceRehabDay).not.toHaveBeenCalled()
  })

  it('a correct answer advances one day (below the graduation threshold)', async () => {
    const { deps, advanceRehabDay, unparkAndSoftReentry } = createDeps()
    advanceRehabDay.mockResolvedValue(1)
    const outcome = await applyGateAnswer({ lookup: makeParkedLookup(), pool: 'passive', correct: true, deps })
    expect(outcome).toEqual({ rehabCorrectDays: 1, graduated: false })
    expect(advanceRehabDay).toHaveBeenCalledWith({ userLookupId: lookupId, pool: 'passive' })
    expect(unparkAndSoftReentry).not.toHaveBeenCalled()
  })

  it('a second same-day correct answer does not double-advance (repo guard returns null)', async () => {
    const { deps, advanceRehabDay, unparkAndSoftReentry } = createDeps()
    advanceRehabDay.mockResolvedValue(null) // already credited today
    const outcome = await applyGateAnswer({
      lookup: makeParkedLookup({ leech_rehab_correct_days: 1 }),
      pool: 'passive',
      correct: true,
      deps,
    })
    expect(outcome).toEqual({ rehabCorrectDays: 1, graduated: false })
    expect(unparkAndSoftReentry).not.toHaveBeenCalled()
  })

  it('graduates at the threshold via one-shot soft re-entry with the softened schedule', async () => {
    const { deps, advanceRehabDay, unparkAndSoftReentry } = createDeps()
    advanceRehabDay.mockResolvedValue(3)
    const outcome = await applyGateAnswer({
      lookup: makeParkedLookup({ leech_rehab_correct_days: 2 }),
      pool: 'passive',
      correct: true,
      deps,
    })
    expect(outcome).toEqual({ rehabCorrectDays: 3, graduated: true })
    expect(unparkAndSoftReentry).toHaveBeenCalledWith(
      expect.objectContaining({
        userLookupId: lookupId,
        pool: 'passive',
        state: 'review',
        stability: SOFT_REENTRY_STABILITY,
        difficulty: SOFT_REENTRY_DIFFICULTY,
      })
    )
  })

  it('reads the active rehab family for the active pool', async () => {
    const { deps, advanceRehabDay } = createDeps()
    advanceRehabDay.mockResolvedValue(1)
    const lookup = makeParkedLookup({
      leech_parked_at: null,
      active_leech_parked_at: '2026-06-01T00:00:00Z',
      active_leech_rehab_correct_days: 0,
    })
    const outcome = await applyGateAnswer({ lookup, pool: 'active', correct: true, deps })
    expect(outcome).toEqual({ rehabCorrectDays: 1, graduated: false })
    expect(advanceRehabDay).toHaveBeenCalledWith({ userLookupId: lookupId, pool: 'active' })
  })
})
