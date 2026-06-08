import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import type { DbStudyFacet } from '../../transport/database/study-facets/study-facets-repository'
import { rateTerm, type RateTermDependencies } from './rate-term'

const userId = '00000000-0000-0000-0000-000000000001'
const lookupId = '00000000-0000-0000-0000-000000000004'
const eventId = '00000000-0000-0000-0000-00000000000e'

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
    learning_mode: 'passive',
    created_at: '2026-05-12T00:00:00Z',
    deleted_at: null,
    ...overrides,
  }) as DbUserLookup

// The facet carries the SRS/leech state now. Default: citation recognition,
// never seen.
const makeFacet = (overrides: Partial<DbStudyFacet> = {}): DbStudyFacet =>
  ({
    id: '00000000-0000-0000-0000-0000000000f0',
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

const createDeps = (lookup: DbUserLookup | null, facet: DbStudyFacet | null = makeFacet()) => {
  const initializeCitationFacetIfUnderDailyCap = vi.fn().mockResolvedValue(true)
  const initializeFacet = vi.fn().mockResolvedValue(undefined)
  const applyFsrsResultForFacet = vi.fn().mockResolvedValue(undefined)
  const parkLeechFacet = vi.fn().mockResolvedValue(undefined)
  const ensureCitationFacet = vi.fn().mockResolvedValue(undefined)
  const getFacet = vi.fn().mockResolvedValue(facet)
  // Insert returns the new event's id (the undo handle rateTerm surfaces).
  const insertRatingEvent = vi.fn().mockResolvedValue(eventId)
  const warmExerciseBank = vi.fn()
  const deps = {
    userLookupsRepository: {
      findByIdForUser: vi.fn().mockResolvedValue(lookup),
    },
    studyFacetsRepository: {
      ensureCitationFacet,
      getFacet,
      initializeCitationFacetIfUnderDailyCap,
      initializeFacet,
      applyFsrsResultForFacet,
      parkLeechFacet,
    },
    practiceRatingEventsRepository: {
      insert: insertRatingEvent,
    },
    userTargetLanguagePrefsRepository: {
      getPracticeLimitsForLanguage: vi.fn().mockResolvedValue({ maxNewTerms: 20, maxReviewTerms: 100 }),
    },
    // Unit fake: run the callback with no real executor — repo mocks ignore it.
    withTransaction: (fn: (tx: undefined) => Promise<unknown>) => fn(undefined),
    warmExerciseBank,
  } as unknown as RateTermDependencies
  return {
    deps,
    initializeCitationFacetIfUnderDailyCap,
    initializeFacet,
    applyFsrsResultForFacet,
    parkLeechFacet,
    insertRatingEvent,
    warmExerciseBank,
  }
}

describe('rateTerm', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('introduces a never-reviewed passive facet via the daily-cap guard, then applies FSRS', async () => {
    const { deps, initializeCitationFacetIfUnderDailyCap, applyFsrsResultForFacet } = createDeps(makeLookup())
    const result = await rateTerm(lookupId, userId, 'good', 'passive', deps)
    expect(result).toEqual({ ok: true, introducedNew: true, dailyCapReached: false, parked: false, eventId })
    expect(initializeCitationFacetIfUnderDailyCap).toHaveBeenCalledWith(
      expect.objectContaining({ userLookupId: lookupId, maxNewTerms: 20, targetLanguage: 'es' })
    )
    expect(applyFsrsResultForFacet).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'meaning_recognition', targetForm: '' }),
      undefined
    )
  })

  it('refuses a new passive facet when the daily cap is reached and applies no FSRS', async () => {
    const { deps, initializeCitationFacetIfUnderDailyCap, applyFsrsResultForFacet } = createDeps(makeLookup())
    initializeCitationFacetIfUnderDailyCap.mockResolvedValue(false)
    const result = await rateTerm(lookupId, userId, 'good', 'passive', deps)
    expect(result).toEqual({ ok: true, introducedNew: false, dailyCapReached: true, parked: false, eventId: null })
    expect(applyFsrsResultForFacet).not.toHaveBeenCalled()
  })

  it('skips the cap guard for an already-scheduled passive facet', async () => {
    const { deps, initializeCitationFacetIfUnderDailyCap, applyFsrsResultForFacet } = createDeps(
      makeLookup(),
      makeFacet({ srs_state: 'review', srs_due: '2026-05-12T00:00:00Z' })
    )
    const result = await rateTerm(lookupId, userId, 'good', 'passive', deps)
    expect(result).toEqual({ ok: true, introducedNew: false, dailyCapReached: false, parked: false, eventId })
    expect(initializeCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
    expect(applyFsrsResultForFacet).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'meaning_recognition', targetForm: '' }),
      undefined
    )
  })

  it('routes active-pool ratings to the production facet with no daily cap', async () => {
    const { deps, initializeCitationFacetIfUnderDailyCap, initializeFacet, applyFsrsResultForFacet } = createDeps(
      makeLookup({ learning_mode: 'active' }),
      makeFacet({ skill: 'meaning_production' })
    )
    const result = await rateTerm(lookupId, userId, 'good', 'active', deps)
    expect(result).toEqual({ ok: true, introducedNew: true, dailyCapReached: false, parked: false, eventId })
    expect(initializeCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
    expect(initializeFacet).toHaveBeenCalledWith({ userLookupId: lookupId, skill: 'meaning_production', targetForm: '' })
    expect(applyFsrsResultForFacet).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'meaning_production', targetForm: '' }),
      undefined
    )
  })

  it('refuses active-pool ratings for terms not promoted to active learning', async () => {
    const { deps, initializeFacet, applyFsrsResultForFacet } = createDeps(makeLookup())
    const result = await rateTerm(lookupId, userId, 'good', 'active', deps)
    expect(result).toEqual({ ok: false, reason: 'not_in_active_pool' })
    expect(initializeFacet).not.toHaveBeenCalled()
    expect(applyFsrsResultForFacet).not.toHaveBeenCalled()
  })

  it('returns lookup_not_found when the term is missing', async () => {
    const { deps } = createDeps(null)
    const result = await rateTerm(lookupId, userId, 'good', 'passive', deps)
    expect(result).toEqual({ ok: false, reason: 'lookup_not_found' })
  })

  it('bypassDailyCap threads bypassCap into the introduction guard', async () => {
    const { deps, initializeCitationFacetIfUnderDailyCap, applyFsrsResultForFacet } = createDeps(makeLookup())
    const result = await rateTerm(lookupId, userId, 'good', 'passive', deps, { bypassDailyCap: true })
    expect(result).toEqual({ ok: true, introducedNew: true, dailyCapReached: false, parked: false, eventId })
    expect(initializeCitationFacetIfUnderDailyCap).toHaveBeenCalledWith(expect.objectContaining({ bypassCap: true }))
    expect(applyFsrsResultForFacet).toHaveBeenCalled()
  })

  it('does not bypass the cap by default', async () => {
    const { deps, initializeCitationFacetIfUnderDailyCap } = createDeps(makeLookup())
    await rateTerm(lookupId, userId, 'good', 'passive', deps)
    expect(initializeCitationFacetIfUnderDailyCap).toHaveBeenCalledWith(expect.objectContaining({ bypassCap: false }))
  })
})

describe('rateTerm rating-event log', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('logs an introduction event with null prev state alongside the FSRS write', async () => {
    const { deps, insertRatingEvent } = createDeps(makeLookup())
    await rateTerm(lookupId, userId, 'good', 'passive', deps)
    expect(insertRatingEvent).toHaveBeenCalledTimes(1)
    expect(insertRatingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        userLookupId: lookupId,
        targetLanguage: 'es',
        pool: 'passive',
        rating: 'good',
        wasExplicit: true,
        wasIntroduction: true,
        causedParking: false,
        practiceTextId: null,
        headword: 'gato',
        sense: 'cat',
        prevSrsState: null,
        prevSrsDue: null,
      }),
      undefined
    )
  })

  it('logs a review event with the pre-rating SRS snapshot', async () => {
    const { deps, insertRatingEvent } = createDeps(
      makeLookup(),
      makeFacet({
        srs_state: 'review',
        srs_due: '2026-05-12T00:00:00Z',
        srs_stability: 5,
        srs_difficulty: 6,
        srs_last_review: '2026-05-01T00:00:00Z',
        srs_reps: 8,
        srs_lapses: 1,
      })
    )
    await rateTerm(lookupId, userId, 'hard', 'passive', deps)
    expect(insertRatingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        rating: 'hard',
        wasIntroduction: false,
        prevSrsState: 'review',
        prevSrsDue: '2026-05-12T00:00:00Z',
        prevSrsStability: 5,
        prevSrsDifficulty: 6,
        prevSrsLastReview: '2026-05-01T00:00:00Z',
        prevSrsReps: 8,
        prevSrsLapses: 1,
      }),
      undefined
    )
  })

  it('snapshots the production facet for active-pool events', async () => {
    const { deps, insertRatingEvent } = createDeps(
      makeLookup({ learning_mode: 'active' }),
      makeFacet({
        skill: 'meaning_production',
        srs_state: 'review',
        srs_due: '2026-05-12T00:00:00Z',
        srs_reps: 4,
        srs_lapses: 2,
      })
    )
    await rateTerm(lookupId, userId, 'good', 'active', deps)
    expect(insertRatingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        pool: 'active',
        wasIntroduction: false,
        prevSrsState: 'review',
        prevSrsDue: '2026-05-12T00:00:00Z',
        prevSrsReps: 4,
        prevSrsLapses: 2,
      }),
      undefined
    )
  })

  it('records caused_parking on the rating that crosses the leech threshold', async () => {
    const { deps, insertRatingEvent } = createDeps(
      makeLookup(),
      makeFacet({
        srs_state: 'review',
        srs_due: '2026-05-01T00:00:00Z',
        srs_stability: 5,
        srs_difficulty: 6,
        srs_last_review: '2026-04-20T00:00:00Z',
        srs_reps: 8,
        srs_lapses: 3,
      })
    )
    await rateTerm(lookupId, userId, 'again', 'passive', deps)
    expect(insertRatingEvent).toHaveBeenCalledWith(expect.objectContaining({ causedParking: true }), undefined)
  })

  it('logs NO event when the daily cap refuses the introduction', async () => {
    const { deps, initializeCitationFacetIfUnderDailyCap, insertRatingEvent } = createDeps(makeLookup())
    initializeCitationFacetIfUnderDailyCap.mockResolvedValue(false)
    await rateTerm(lookupId, userId, 'good', 'passive', deps)
    expect(insertRatingEvent).not.toHaveBeenCalled()
  })

  it('logs NO event for a parked no-op rating', async () => {
    const { deps, insertRatingEvent } = createDeps(
      makeLookup(),
      makeFacet({ srs_state: 'review', srs_due: '2026-05-01T00:00:00Z', leech_parked_at: '2026-05-01T00:00:00Z' })
    )
    await rateTerm(lookupId, userId, 'again', 'passive', deps)
    expect(insertRatingEvent).not.toHaveBeenCalled()
  })

  it('logs NO event for a not-in-active-pool refusal', async () => {
    const { deps, insertRatingEvent } = createDeps(makeLookup())
    await rateTerm(lookupId, userId, 'good', 'active', deps)
    expect(insertRatingEvent).not.toHaveBeenCalled()
  })
})

// Parking goes through the SHARED applyTermRating path (rateTerm here, the
// reading finalizer in advance-reading-text.unit.test.ts). Threshold is 4;
// the condition is a new-lapse DELTA, not an absolute check.
describe('rateTerm leech parking', () => {
  beforeEach(() => vi.restoreAllMocks())

  const reviewFacet = (lapses: number, overrides: Partial<DbStudyFacet> = {}) =>
    makeFacet({
      srs_state: 'review',
      srs_due: '2026-05-01T00:00:00Z',
      srs_stability: 5,
      srs_difficulty: 6,
      srs_last_review: '2026-04-20T00:00:00Z',
      srs_reps: 8,
      srs_lapses: lapses,
      ...overrides,
    })

  it("parks on the 'again' that crosses the lapse threshold and reports parked", async () => {
    const { deps, parkLeechFacet, warmExerciseBank } = createDeps(makeLookup(), reviewFacet(3))
    const result = await rateTerm(lookupId, userId, 'again', 'passive', deps)
    // The rating applied (then parked), so it carries an undo handle.
    expect(result).toEqual({ ok: true, introducedNew: false, dailyCapReached: false, parked: true, eventId })
    expect(parkLeechFacet).toHaveBeenCalledWith({ userLookupId: lookupId, skill: 'meaning_recognition', targetForm: '' })
    // A freshly parked leech warms its gate-exercise bank.
    expect(warmExerciseBank).toHaveBeenCalled()
  })

  it("does NOT re-park a graduated facet (historical lapses >= threshold) on 'good'", async () => {
    const { deps, parkLeechFacet } = createDeps(makeLookup(), reviewFacet(5))
    const result = await rateTerm(lookupId, userId, 'good', 'passive', deps)
    expect(result).toEqual({ ok: true, introducedNew: false, dailyCapReached: false, parked: false, eventId })
    expect(parkLeechFacet).not.toHaveBeenCalled()
  })

  it('re-parks a graduated facet on its next FRESH lapse', async () => {
    const { deps, parkLeechFacet } = createDeps(makeLookup(), reviewFacet(5))
    const result = await rateTerm(lookupId, userId, 'again', 'passive', deps)
    expect(result).toEqual({ ok: true, introducedNew: false, dailyCapReached: false, parked: true, eventId })
    expect(parkLeechFacet).toHaveBeenCalledWith({ userLookupId: lookupId, skill: 'meaning_recognition', targetForm: '' })
  })

  it('does not park below the threshold', async () => {
    const { deps, parkLeechFacet } = createDeps(makeLookup(), reviewFacet(1))
    const result = await rateTerm(lookupId, userId, 'again', 'passive', deps)
    expect(result).toEqual({ ok: true, introducedNew: false, dailyCapReached: false, parked: false, eventId })
    expect(parkLeechFacet).not.toHaveBeenCalled()
  })

  it('accepts but does not mutate a stale rating for an already parked facet', async () => {
    const { deps, applyFsrsResultForFacet, parkLeechFacet, warmExerciseBank } = createDeps(
      makeLookup(),
      reviewFacet(5, { leech_parked_at: '2026-05-01T00:00:00Z' })
    )
    const result = await rateTerm(lookupId, userId, 'again', 'passive', deps)
    // Nothing was applied (parked no-op) — no event, so no undo handle.
    expect(result).toEqual({ ok: true, introducedNew: false, dailyCapReached: false, parked: true, eventId: null })
    expect(applyFsrsResultForFacet).not.toHaveBeenCalled()
    expect(parkLeechFacet).not.toHaveBeenCalled()
    expect(warmExerciseBank).not.toHaveBeenCalled()
  })

  it('parks in the active pool off the production facet', async () => {
    const { deps, parkLeechFacet } = createDeps(
      makeLookup({ learning_mode: 'active' }),
      reviewFacet(3, { skill: 'meaning_production' })
    )
    const result = await rateTerm(lookupId, userId, 'again', 'active', deps)
    expect(result).toEqual({ ok: true, introducedNew: false, dailyCapReached: false, parked: true, eventId })
    expect(parkLeechFacet).toHaveBeenCalledWith({ userLookupId: lookupId, skill: 'meaning_production', targetForm: '' })
  })
})
