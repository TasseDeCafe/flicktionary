import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import type { DbStudyFacet } from '../../transport/database/study-facets/study-facets-repository'
import { bridgeRecognitionFromProduction, type RecognitionBridgeDependencies } from './recognition-bridge'

const userId = '00000000-0000-0000-0000-000000000001'
const lookupId = '00000000-0000-0000-0000-000000000004'

const makeLookup = (): DbUserLookup =>
  ({
    id: lookupId,
    user_id: userId,
    target_language: 'es',
    headword: 'gato',
    sense: 'cat',
    count: 1,
    created_at: '2026-05-12T00:00:00Z',
    deleted_at: null,
  }) as DbUserLookup

const makeRecognitionFacet = (overrides: Partial<DbStudyFacet> = {}): DbStudyFacet =>
  ({
    id: '00000000-0000-0000-0000-0000000000f1',
    user_lookup_id: lookupId,
    user_id: userId,
    target_language: 'es',
    skill: 'meaning_recognition',
    target_form: '',
    srs_state: null,
    srs_due: null,
    srs_stability: null,
    srs_difficulty: null,
    srs_last_review: null,
    srs_reps: 0,
    srs_lapses: 0,
    srs_learning_steps: 0,
    leech_parked_at: null,
    leech_rehab_correct_days: 0,
    leech_rehab_last_correct_on: null,
    introduced_at: null,
    payload: {},
    data_status: 'ready',
    source: 'system',
    disabled_at: null,
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }) as DbStudyFacet

const createDeps = (facet: DbStudyFacet | null, lockedFacet: DbStudyFacet | null = facet) => {
  const getFacet = vi.fn().mockResolvedValue(facet)
  const getFacetForUpdate = vi.fn().mockResolvedValue(lockedFacet)
  const seedKnownAssertFacet = vi.fn().mockResolvedValue(true)
  const applyFsrsResultForFacet = vi.fn().mockResolvedValue(undefined)
  const deps = {
    studyFacetsRepository: {
      getFacet,
      getFacetForUpdate,
      seedKnownAssertFacet,
      applyFsrsResultForFacet,
    },
    withTransaction: (fn: (tx: undefined) => Promise<unknown>) => fn(undefined),
  } as unknown as RecognitionBridgeDependencies
  return { deps, getFacet, getFacetForUpdate, seedKnownAssertFacet, applyFsrsResultForFacet }
}

describe('bridgeRecognitionFromProduction', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('seeds a never-scheduled facet straight into review with a future due date', async () => {
    const { deps, seedKnownAssertFacet, applyFsrsResultForFacet } = createDeps(makeRecognitionFacet())
    const before = Date.now()
    await bridgeRecognitionFromProduction({ lookup: makeLookup(), deps })
    expect(seedKnownAssertFacet).toHaveBeenCalledTimes(1)
    const seed = seedKnownAssertFacet.mock.calls[0][0]
    expect(seed).toMatchObject({
      userLookupId: lookupId,
      skill: 'meaning_recognition',
      targetForm: '',
      state: 'review',
    })
    expect(seed.due.getTime()).toBeGreaterThan(before)
    // The seed path never runs the FSRS-refresh write.
    expect(applyFsrsResultForFacet).not.toHaveBeenCalled()
  })

  it('refreshes an already-scheduled facet with an implicit FSRS good under the row lock', async () => {
    const scheduled = makeRecognitionFacet({
      srs_state: 'review',
      srs_due: '2026-05-10T00:00:00Z',
      srs_stability: 10,
      srs_difficulty: 5,
      srs_last_review: '2026-05-01T00:00:00Z',
      srs_reps: 4,
      srs_lapses: 1,
    })
    const { deps, seedKnownAssertFacet, applyFsrsResultForFacet } = createDeps(scheduled)
    await bridgeRecognitionFromProduction({ lookup: makeLookup(), deps })
    expect(seedKnownAssertFacet).not.toHaveBeenCalled()
    expect(applyFsrsResultForFacet).toHaveBeenCalledTimes(1)
    const write = applyFsrsResultForFacet.mock.calls[0][0]
    expect(write).toMatchObject({
      userLookupId: lookupId,
      skill: 'meaning_recognition',
      targetForm: '',
      state: 'review',
    })
    // A good on a review card advances the schedule and preserves history.
    expect(write.due.getTime()).toBeGreaterThan(Date.now())
    expect(write.reps).toBe(5)
    expect(write.lapses).toBe(1)
  })

  it('does nothing for a missing facet', async () => {
    const { deps, seedKnownAssertFacet, applyFsrsResultForFacet } = createDeps(null)
    await bridgeRecognitionFromProduction({ lookup: makeLookup(), deps })
    expect(seedKnownAssertFacet).not.toHaveBeenCalled()
    expect(applyFsrsResultForFacet).not.toHaveBeenCalled()
  })

  it('does nothing for a disabled facet', async () => {
    const { deps, seedKnownAssertFacet, applyFsrsResultForFacet } = createDeps(
      makeRecognitionFacet({ disabled_at: '2026-05-01T00:00:00Z' })
    )
    await bridgeRecognitionFromProduction({ lookup: makeLookup(), deps })
    expect(seedKnownAssertFacet).not.toHaveBeenCalled()
    expect(applyFsrsResultForFacet).not.toHaveBeenCalled()
  })

  it('does nothing for a parked facet — rehab state stays frozen', async () => {
    const { deps, seedKnownAssertFacet, applyFsrsResultForFacet } = createDeps(
      makeRecognitionFacet({ leech_parked_at: '2026-05-01T00:00:00Z' })
    )
    await bridgeRecognitionFromProduction({ lookup: makeLookup(), deps })
    expect(seedKnownAssertFacet).not.toHaveBeenCalled()
    expect(applyFsrsResultForFacet).not.toHaveBeenCalled()
  })

  it('abandons the refresh when the locked reload shows the facet was parked concurrently', async () => {
    const scheduled = makeRecognitionFacet({ srs_state: 'review', srs_due: '2026-05-10T00:00:00Z' })
    const { deps, applyFsrsResultForFacet } = createDeps(
      scheduled,
      makeRecognitionFacet({
        srs_state: 'review',
        srs_due: '2026-05-10T00:00:00Z',
        leech_parked_at: '2026-05-12T00:00:00Z',
      })
    )
    await bridgeRecognitionFromProduction({ lookup: makeLookup(), deps })
    expect(applyFsrsResultForFacet).not.toHaveBeenCalled()
  })
})
