import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'
import type { DbStudySession } from '../../transport/database/study-sessions/study-sessions-repository'
import type { SessionKeptCitationFacet } from '../../transport/database/study-facets/study-facets-repository'
import { startWarmupSession, type WarmupDependencies } from './warmup'

const userId = '00000000-0000-0000-0000-000000000001'
const sessionId = '00000000-0000-0000-0000-0000000000a0'
const lang = 'es'

const id = (n: number) => `00000000-0000-0000-0000-0000000000${n.toString().padStart(2, '0')}`

const makeSession = (overrides: Partial<DbStudySession> = {}): DbStudySession =>
  ({ id: sessionId, user_id: userId, target_language: lang, deleted_at: null, ...overrides }) as DbStudySession

const facetState = (overrides: Partial<SessionKeptCitationFacet>): SessionKeptCitationFacet => ({
  userLookupId: id(1),
  hasFacet: true,
  srsState: null,
  leechParkedAt: null,
  disabledAt: null,
  ...overrides,
})

const parkedRow = (lookupId: string): DbUserLookupWithFacet =>
  ({
    id: lookupId,
    user_id: userId,
    target_language: lang,
    headword: `w-${lookupId}`,
    sense: '',
    skill: 'meaning_recognition',
    target_form: '',
    leech_rehab_correct_days: 0,
  }) as DbUserLookupWithFacet

const createDeps = (params: {
  session?: DbStudySession | null
  // Recognition-pool session facets (the default skill). Production facets
  // default to [] so existing recognition-only tests are unaffected.
  facetStates: SessionKeptCitationFacet[]
  productionFacetStates?: SessionKeptCitationFacet[]
  parkOutcomes?: Record<string, 'scaffolded' | 'cap_reached' | 'not_eligible'>
  productionParkOutcomes?: Record<string, 'scaffolded' | 'cap_reached' | 'not_eligible'>
  maxNewTerms?: number
}) => {
  const findByIdForUser = vi.fn().mockResolvedValue(params.session === undefined ? makeSession() : params.session)
  const getPracticeLimitsForLanguage = vi
    .fn()
    .mockResolvedValue({ maxNewTerms: params.maxNewTerms ?? 20, maxReviewTerms: 100, maxReviewTermsProduction: null })
  // Skill-aware: the production pass reads the meaning_production facets.
  const listSessionKeptCitationFacets = vi
    .fn()
    .mockImplementation(async (_sessionId: string, skill: string = 'meaning_recognition') =>
      skill === 'meaning_production' ? (params.productionFacetStates ?? []) : params.facetStates
    )
  // One skill-aware guard for both pools (they share the combined budget).
  const initializeAndParkCitationFacetIfUnderDailyCap = vi
    .fn()
    .mockImplementation(async (p: { userLookupId: string; skill: string }) =>
      p.skill === 'meaning_production'
        ? (params.productionParkOutcomes?.[p.userLookupId] ?? 'scaffolded')
        : (params.parkOutcomes?.[p.userLookupId] ?? 'scaffolded')
    )
  // getStrengthenExercises (real) calls these; the warm-up has no bonus track.
  // The session warm-up always supplies a restrict set — serve exactly those
  // ids. Production serves get an empty restrict in recognition-only fixtures
  // → no rows.
  const listParkedTerms = vi
    .fn()
    .mockImplementation(async (p: { restrictToUserLookupIds?: string[] }) =>
      (p.restrictToUserLookupIds ?? []).map(parkedRow)
    )
  const selectNextExercise = vi.fn().mockResolvedValue(null)
  const reserveSlots = vi.fn().mockResolvedValue([])
  const listBonusForTerms = vi.fn().mockResolvedValue([])
  const countGateBankSlots = vi.fn().mockResolvedValue({ inflight: 0, failed: 0, failedTypes: 0 })

  const deps = {
    studySessionsRepository: { findByIdForUser },
    userTargetLanguagePrefsRepository: { getPracticeLimitsForLanguage },
    studyFacetsRepository: {
      listSessionKeptCitationFacets,
      initializeAndParkCitationFacetIfUnderDailyCap,
    },
    userLookupsRepository: { listParkedTerms },
    practiceExercisesRepository: { selectNextExercise, reserveSlots, listBonusForTerms, countGateBankSlots },
    usersRepository: {},
  } as unknown as WarmupDependencies

  return {
    deps,
    findByIdForUser,
    initializeAndParkCitationFacetIfUnderDailyCap,
    listParkedTerms,
  }
}

// listParkedTerms is called once per pool; pick the call for a given pool by
// the parkedOrigin+restrict shape isn't enough, so use the production-first
// invocation order shared with the composed queue.
const productionParkedCall = (listParkedTerms: ReturnType<typeof vi.fn>) => listParkedTerms.mock.calls[0][0]
const recognitionParkedCall = (listParkedTerms: ReturnType<typeof vi.fn>) => listParkedTerms.mock.calls[1][0]

describe('startWarmupSession', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('rejects a session that is not the user’s (not_found)', async () => {
    const { deps } = createDeps({ session: null, facetStates: [] })
    const result = await startWarmupSession({ userId, studySessionId: sessionId, targetLanguage: lang, deps })
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('rejects a target-language mismatch (language_mismatch)', async () => {
    const { deps } = createDeps({ session: makeSession({ target_language: 'fr' }), facetStates: [] })
    const result = await startWarmupSession({ userId, studySessionId: sessionId, targetLanguage: lang, deps })
    expect(result).toEqual({ ok: false, reason: 'language_mismatch' })
  })

  it('only scaffolds eligible terms (enabled, never-reviewed, unparked) and skips the rest', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      facetStates: [
        facetState({ userLookupId: id(1) }), // eligible
        facetState({ userLookupId: id(2), srsState: 'review' }), // already a live flashcard
        facetState({ userLookupId: id(3), disabledAt: '2026-01-01T00:00:00Z' }), // disabled
        facetState({ userLookupId: id(4), hasFacet: false }), // legacy, no facet
        facetState({ userLookupId: id(5), leechParkedAt: '2026-01-01T00:00:00Z', srsState: 'relearning' }), // real leech
      ],
    })
    const result = await startWarmupSession({ userId, studySessionId: sessionId, targetLanguage: lang, deps })
    expect(result.ok).toBe(true)
    const enteredIds = initializeAndParkCitationFacetIfUnderDailyCap.mock.calls.map((c) => c[0].userLookupId)
    expect(enteredIds).toEqual([id(1)])
  })

  it('cap_reached sets dailyLimitReached and stops entering further terms', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      facetStates: [facetState({ userLookupId: id(1) }), facetState({ userLookupId: id(2) })],
      parkOutcomes: { [id(1)]: 'cap_reached', [id(2)]: 'scaffolded' },
    })
    const result = await startWarmupSession({ userId, studySessionId: sessionId, targetLanguage: lang, deps })
    expect(result.ok && result.dailyLimitReached).toBe(true)
    // Stopped at the first cap hit — never tried the second term.
    expect(initializeAndParkCitationFacetIfUnderDailyCap).toHaveBeenCalledTimes(1)
  })

  it('not_eligible (concurrent-park race) does NOT set dailyLimitReached', async () => {
    const { deps, listParkedTerms } = createDeps({
      facetStates: [facetState({ userLookupId: id(1) })],
      parkOutcomes: { [id(1)]: 'not_eligible' },
    })
    const result = await startWarmupSession({ userId, studySessionId: sessionId, targetLanguage: lang, deps })
    expect(result.ok && result.dailyLimitReached).toBe(false)
    // A term that lost the race is already parked elsewhere; it isn't served by
    // THIS call (it wasn't in the already-onboarding set nor newly scaffolded).
    const restrict = recognitionParkedCall(listParkedTerms).restrictToUserLookupIds
    expect(restrict).toEqual([])
  })

  it("a recognition cap hit doesn't stop the production pass, and either pass's cap flags the limit", async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap, listParkedTerms } = createDeps({
      // Recognition caps on its only term.
      facetStates: [facetState({ userLookupId: id(1) })],
      parkOutcomes: { [id(1)]: 'cap_reached' },
      // A different term is eligible for production warm-up (the mock lets it
      // through; in reality the shared guard decides per candidate).
      productionFacetStates: [facetState({ userLookupId: id(2) })],
    })
    const result = await startWarmupSession({ userId, studySessionId: sessionId, targetLanguage: lang, deps })
    // Recognition hit its cap...
    expect(result.ok && result.dailyLimitReached).toBe(true)
    // ...but the production pass still ran its own guard, under the SAME
    // combined budget (maxNewTerms passes through).
    expect(initializeAndParkCitationFacetIfUnderDailyCap).toHaveBeenCalledWith(
      expect.objectContaining({ userLookupId: id(2), skill: 'meaning_production', maxNewTerms: 20 })
    )
    // Recognition serves nothing (its term was capped, not scaffolded); the
    // production serve covers id(2).
    expect(recognitionParkedCall(listParkedTerms).restrictToUserLookupIds).toEqual([])
    expect(recognitionParkedCall(listParkedTerms).pool).toBe('recognition')
    expect(productionParkedCall(listParkedTerms).restrictToUserLookupIds).toEqual([id(2)])
    expect(productionParkedCall(listParkedTerms).pool).toBe('production')
    // The mixed queue carries the production entry tagged with its pool.
    if (result.ok) {
      expect(result.exercises).toEqual([expect.objectContaining({ userLookupId: id(2), pool: 'production' })])
    }
  })

  it('serves a production-first mixed queue for a both-skills term', async () => {
    const { deps } = createDeps({
      facetStates: [facetState({ userLookupId: id(1) })],
      productionFacetStates: [facetState({ userLookupId: id(1) })],
    })
    const result = await startWarmupSession({ userId, studySessionId: sessionId, targetLanguage: lang, deps })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Same userLookupId, two entries, one per pool — exactly the case the
      // client merge must key on (pool, userLookupId).
      expect(result.exercises).toEqual([
        expect.objectContaining({ userLookupId: id(1), pool: 'production' }),
        expect.objectContaining({ userLookupId: id(1), pool: 'recognition' }),
      ])
    }
  })

  it('resume: re-serves already-onboarding terms without re-introducing them', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap, listParkedTerms } = createDeps({
      facetStates: [
        // Parked in a prior visit (parked + never-reviewed = onboarding).
        facetState({ userLookupId: id(1), leechParkedAt: '2026-06-01T00:00:00Z' }),
        // A fresh eligible term entering this call.
        facetState({ userLookupId: id(2) }),
      ],
    })
    const result = await startWarmupSession({ userId, studySessionId: sessionId, targetLanguage: lang, deps })
    expect(result.ok).toBe(true)
    // Only the fresh term is (re-)introduced; the already-parked one is not.
    const enteredIds = initializeAndParkCitationFacetIfUnderDailyCap.mock.calls.map((c) => c[0].userLookupId)
    expect(enteredIds).toEqual([id(2)])
    // Both are served (union of already-onboarding + newly scaffolded).
    const restrict = recognitionParkedCall(listParkedTerms).restrictToUserLookupIds
    expect(new Set(restrict)).toEqual(new Set([id(1), id(2)]))
    if (result.ok) expect(result.exercises.map((e) => e.userLookupId).sort()).toEqual([id(1), id(2)])
  })
})
