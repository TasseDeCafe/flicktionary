import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import { rateTerm, type RateTermDependencies } from './rate-term'

const userId = '00000000-0000-0000-0000-000000000001'
const lookupId = '00000000-0000-0000-0000-000000000004'

const makeLookup = (overrides: Partial<DbUserLookup> = {}): DbUserLookup =>
  ({
    id: lookupId,
    user_id: userId,
    target_language: 'es',
    headword: 'gato',
    sense: 'cat',
    translation: 'cat',
    definition: null,
    target_example: null,
    native_example: null,
    exploration_extras: {},
    grammar: {},
    grounded_at: null,
    grammar_user_edited_at: null,
    first_card_id: null,
    exported_at: null,
    count: 1,
    srs_state: null,
    srs_due: null,
    srs_stability: null,
    srs_difficulty: null,
    srs_last_review: null,
    srs_reps: 0,
    srs_lapses: 0,
    added_to_practice_at: null,
    learning_mode: 'passive',
    active_srs_state: null,
    active_srs_due: null,
    active_srs_stability: null,
    active_srs_difficulty: null,
    active_srs_last_review: null,
    active_srs_reps: 0,
    active_srs_lapses: 0,
    created_at: '2026-05-12T00:00:00Z',
    deleted_at: null,
    ...overrides,
  }) as DbUserLookup

const createDeps = (lookup: DbUserLookup | null) => {
  const initializeSrsStateIfUnderDailyCap = vi.fn().mockResolvedValue(true)
  const initializeSrsStateForPool = vi.fn().mockResolvedValue(undefined)
  const applyFsrsResultForPool = vi.fn().mockResolvedValue(undefined)
  const deps = {
    userLookupsRepository: {
      findByIdForUser: vi.fn().mockResolvedValue(lookup),
      initializeSrsStateIfUnderDailyCap,
      initializeSrsStateForPool,
      applyFsrsResultForPool,
    },
  } as unknown as RateTermDependencies
  return { deps, initializeSrsStateIfUnderDailyCap, initializeSrsStateForPool, applyFsrsResultForPool }
}

describe('rateTerm', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('introduces a never-reviewed passive term via the daily-cap guard, then applies FSRS', async () => {
    const { deps, initializeSrsStateIfUnderDailyCap, applyFsrsResultForPool } = createDeps(makeLookup())
    const result = await rateTerm(lookupId, userId, 'good', 'passive', 20, deps)
    expect(result).toEqual({ ok: true, introducedNew: true, dailyCapReached: false })
    expect(initializeSrsStateIfUnderDailyCap).toHaveBeenCalledWith(
      expect.objectContaining({ userLookupId: lookupId, maxNewTerms: 20, targetLanguage: 'es' })
    )
    expect(applyFsrsResultForPool).toHaveBeenCalledWith(expect.objectContaining({ pool: 'passive' }))
  })

  it('refuses a new passive term when the daily cap is reached and applies no FSRS', async () => {
    const { deps, initializeSrsStateIfUnderDailyCap, applyFsrsResultForPool } = createDeps(makeLookup())
    initializeSrsStateIfUnderDailyCap.mockResolvedValue(false)
    const result = await rateTerm(lookupId, userId, 'good', 'passive', 20, deps)
    expect(result).toEqual({ ok: true, introducedNew: false, dailyCapReached: true })
    expect(applyFsrsResultForPool).not.toHaveBeenCalled()
  })

  it('skips the cap guard for an already-scheduled passive term', async () => {
    const { deps, initializeSrsStateIfUnderDailyCap, applyFsrsResultForPool } = createDeps(
      makeLookup({ srs_state: 'review', srs_due: '2026-05-12T00:00:00Z' })
    )
    const result = await rateTerm(lookupId, userId, 'good', 'passive', 20, deps)
    expect(result).toEqual({ ok: true, introducedNew: false, dailyCapReached: false })
    expect(initializeSrsStateIfUnderDailyCap).not.toHaveBeenCalled()
    expect(applyFsrsResultForPool).toHaveBeenCalledWith(expect.objectContaining({ pool: 'passive' }))
  })

  it('routes active-pool ratings to the active SRS family with no daily cap', async () => {
    const { deps, initializeSrsStateIfUnderDailyCap, initializeSrsStateForPool, applyFsrsResultForPool } = createDeps(
      makeLookup({ learning_mode: 'active' })
    )
    const result = await rateTerm(lookupId, userId, 'good', 'active', 20, deps)
    expect(result).toEqual({ ok: true, introducedNew: true, dailyCapReached: false })
    expect(initializeSrsStateIfUnderDailyCap).not.toHaveBeenCalled()
    expect(initializeSrsStateForPool).toHaveBeenCalledWith({ userLookupId: lookupId, pool: 'active' })
    expect(applyFsrsResultForPool).toHaveBeenCalledWith(expect.objectContaining({ pool: 'active' }))
  })

  it('returns lookup_not_found when the term is missing', async () => {
    const { deps } = createDeps(null)
    const result = await rateTerm(lookupId, userId, 'good', 'passive', 20, deps)
    expect(result).toEqual({ ok: false, reason: 'lookup_not_found' })
  })
})
