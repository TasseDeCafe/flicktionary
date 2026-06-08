import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import type { DbStudyFacet } from '../../transport/database/study-facets/study-facets-repository'
import type { DbPracticeText } from '../../transport/database/practice-texts/practice-texts-repository'
import { advanceReadingText, type AdvanceReadingTextDependencies } from './advance-reading-text'

const userId = '00000000-0000-0000-0000-000000000001'
const textId = '00000000-0000-0000-0000-000000000010'
const nextTextId = '00000000-0000-0000-0000-000000000011'
const laId = '00000000-0000-0000-0000-0000000000aa'
const lbId = '00000000-0000-0000-0000-0000000000bb'

const makeLookup = (id: string, overrides: Partial<DbUserLookup> = {}): DbUserLookup =>
  ({
    id,
    user_id: userId,
    target_language: 'es',
    headword: id,
    sense: 's',
    translation: null,
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

// The citation recognition facet carries the SRS/leech state read for
// eligibility + rating.
const makeFacet = (lookupId: string, overrides: Partial<DbStudyFacet> = {}): DbStudyFacet =>
  ({
    id: `facet-${lookupId}`,
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

const claimedText = {
  id: textId,
  user_id: userId,
  target_language: 'es',
  pool: 'passive',
  ord: 0,
  status: 'done',
  body: 'gato y perro',
  annotations: [
    { headword: laId, sense: 's', surface_form: 'gato', char_start: 0, char_end: 4 },
    { headword: lbId, sense: 's', surface_form: 'perro', char_start: 7, char_end: 12 },
  ],
  skipped_chunks: [],
  generation_warning: null,
  generation_token: null,
  created_at: '2026-05-12T00:00:00Z',
  ready_at: null,
  read_at: null,
} as unknown as DbPracticeText

const nextText = { ...claimedText, id: nextTextId, ord: 1, status: 'reading' } as DbPracticeText

const createDeps = (opts: { claimWins: boolean; facets?: Record<string, Partial<DbStudyFacet>> }) => {
  // la is already scheduled (review); lb is new — so rating both should
  // introduce exactly one term.
  const lookupsByKey: Record<string, DbUserLookup> = {
    [`${laId}::s`]: makeLookup(laId),
    [`${lbId}::s`]: makeLookup(lbId),
  }
  const facetOverrides = opts.facets ?? {
    [laId]: { srs_state: 'review', srs_due: '2026-05-12T00:00:00Z' },
    [lbId]: {},
  }
  const findByKey = vi.fn(
    async ({ headword, sense }: { headword: string; sense: string }) => lookupsByKey[`${headword}::${sense}`] ?? null
  )
  const getFacet = vi.fn(async ({ userLookupId }: { userLookupId: string }) =>
    makeFacet(userLookupId, facetOverrides[userLookupId] ?? {})
  )
  const ensureCitationFacet = vi.fn().mockResolvedValue(undefined)
  const applyFsrsResultForFacet = vi.fn().mockResolvedValue(undefined)
  const initializeCitationFacetIfUnderDailyCap = vi.fn().mockResolvedValue(true)
  const initializeFacet = vi.fn().mockResolvedValue(undefined)
  const parkLeechFacet = vi.fn().mockResolvedValue(undefined)
  const insertRatingEvent = vi.fn().mockResolvedValue(undefined)
  const claimFinalize = vi.fn().mockResolvedValue(opts.claimWins ? claimedText : null)
  const selectAndMarkReading = vi.fn().mockResolvedValue(nextText)

  const deps = {
    practiceTextsRepository: {
      findByIdForUser: vi.fn().mockResolvedValue({ practiceText: claimedText, targetLanguage: 'es', pool: 'passive' }),
      claimFinalize,
      failMismatchedScopeSlots: vi.fn().mockResolvedValue(undefined),
      selectAndMarkReading,
      reserveOrFindNextSlot: vi.fn(),
      markReading: vi.fn(),
      findById: vi.fn(),
      claimGenerating: vi.fn(),
      markReady: vi.fn(),
      markFailed: vi.fn(),
    },
    userLookupsRepository: {
      findByKey,
      listReviewTerms: vi.fn().mockResolvedValue([]),
      listDueSummary: vi.fn().mockResolvedValue([]),
    },
    studyFacetsRepository: {
      ensureCitationFacet,
      getFacet,
      initializeCitationFacetIfUnderDailyCap,
      initializeFacet,
      applyFsrsResultForFacet,
      parkLeechFacet,
    },
    usersRepository: {
      getNativeLanguage: vi.fn().mockResolvedValue('en'),
    },
    userTargetLanguagePrefsRepository: {
      getShowTranslationsEnabled: vi.fn().mockResolvedValue(true),
      getPracticeLimitsForLanguage: vi.fn().mockResolvedValue({ maxNewTerms: 20, maxReviewTerms: 100 }),
    },
    practiceRatingEventsRepository: {
      insert: insertRatingEvent,
      countReviewBudgetConsumedToday: vi.fn().mockResolvedValue(0),
      countReviewBudgetConsumedTodayByLanguage: vi.fn().mockResolvedValue(new Map()),
    },
    // Unit fake: run the callback with no real executor — repo mocks ignore it.
    withTransaction: (fn: (tx: undefined) => Promise<unknown>) => fn(undefined),
  } as unknown as AdvanceReadingTextDependencies

  return {
    deps,
    findByKey,
    getFacet,
    applyFsrsResultForFacet,
    claimFinalize,
    selectAndMarkReading,
    parkLeechFacet,
    insertRatingEvent,
    initializeCitationFacetIfUnderDailyCap,
  }
}

describe('advanceReadingText', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('applies the explicit rating to tapped terms and implicit good to the rest, counting introductions', async () => {
    const { deps, applyFsrsResultForFacet } = createDeps({ claimWins: true })
    const result = await advanceReadingText(
      userId,
      textId,
      'passive',
      'mixed',
      [{ userLookupId: laId, rating: 'again' }],
      deps
    )
    expect(result).toEqual({ ok: true, done: false, practiceText: nextText, introduced: 1 })
    // Both annotations graded: la (scheduled, no intro) + lb (new, introduced).
    expect(applyFsrsResultForFacet).toHaveBeenCalledTimes(2)
  })

  it('is idempotent: a lost finalize claim applies no FSRS and still returns the next text', async () => {
    const { deps, applyFsrsResultForFacet, findByKey } = createDeps({ claimWins: false })
    const result = await advanceReadingText(userId, textId, 'passive', 'mixed', [], deps)
    expect(result).toEqual({ ok: true, done: false, practiceText: nextText, introduced: 0 })
    expect(applyFsrsResultForFacet).not.toHaveBeenCalled()
    expect(findByKey).not.toHaveBeenCalled()
  })

  it('skips annotations already reviewed after the text was prepared', async () => {
    const { deps, applyFsrsResultForFacet } = createDeps({
      claimWins: true,
      facets: {
        [laId]: { srs_state: 'review', srs_due: '2026-05-12T00:00:00Z', srs_last_review: '2026-05-12T00:05:00Z' },
        [lbId]: {},
      },
    })
    ;(deps.practiceTextsRepository.claimFinalize as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...claimedText,
      ready_at: '2026-05-12T00:00:00Z',
    })

    const result = await advanceReadingText(userId, textId, 'passive', 'mixed', [], deps)

    expect(result).toEqual({ ok: true, done: false, practiceText: nextText, introduced: 1 })
    expect(applyFsrsResultForFacet).toHaveBeenCalledTimes(1)
    expect(applyFsrsResultForFacet).toHaveBeenCalledWith(expect.objectContaining({ userLookupId: lbId }), undefined)
  })

  it('does not mutate FSRS for parked annotations from stale generated texts', async () => {
    const { deps, applyFsrsResultForFacet, parkLeechFacet } = createDeps({
      claimWins: true,
      facets: {
        [laId]: { srs_state: 'review', srs_due: '2026-05-12T00:00:00Z', leech_parked_at: '2026-05-12T00:01:00Z' },
        [lbId]: {},
      },
    })

    const result = await advanceReadingText(userId, textId, 'passive', 'mixed', [], deps)

    expect(result).toEqual({ ok: true, done: false, practiceText: nextText, introduced: 1 })
    expect(applyFsrsResultForFacet).toHaveBeenCalledTimes(1)
    expect(applyFsrsResultForFacet).toHaveBeenCalledWith(expect.objectContaining({ userLookupId: lbId }), undefined)
    expect(parkLeechFacet).not.toHaveBeenCalled()
  })

  it("parks a leech when a reading-mode 'again' rating crosses the lapse threshold", async () => {
    const { deps, parkLeechFacet } = createDeps({
      claimWins: true,
      facets: {
        // One lapse away from the threshold (4); the explicit 'again' below is
        // the fresh lapse that parks it.
        [laId]: {
          srs_state: 'review',
          srs_due: '2026-05-12T00:00:00Z',
          srs_stability: 5,
          srs_difficulty: 6,
          srs_last_review: '2026-05-01T00:00:00Z',
          srs_reps: 8,
          srs_lapses: 3,
        },
        [lbId]: {},
      },
    })

    const result = await advanceReadingText(
      userId,
      textId,
      'passive',
      'mixed',
      [{ userLookupId: laId, rating: 'again' }],
      deps
    )

    expect(result.ok).toBe(true)
    expect(parkLeechFacet).toHaveBeenCalledWith({ userLookupId: laId, skill: 'meaning_recognition', targetForm: '' })
    // The implicit-good term (lb) must not park.
    expect(parkLeechFacet).toHaveBeenCalledTimes(1)
  })

  it('returns text_not_found when the text is missing or not owned', async () => {
    const { deps } = createDeps({ claimWins: true })
    ;(deps.practiceTextsRepository.findByIdForUser as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const result = await advanceReadingText(userId, textId, 'passive', 'mixed', [], deps)
    expect(result).toEqual({ ok: false, reason: 'text_not_found' })
  })

  it('logs explicit taps wasExplicit:true and untapped annotations wasExplicit:false, with the text id', async () => {
    const { deps, insertRatingEvent } = createDeps({ claimWins: true })
    const result = await advanceReadingText(
      userId,
      textId,
      'passive',
      'mixed',
      [{ userLookupId: laId, rating: 'again' }],
      deps
    )
    expect(result.ok).toBe(true)
    expect(insertRatingEvent).toHaveBeenCalledTimes(2)
    expect(insertRatingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userLookupId: laId,
        rating: 'again',
        wasExplicit: true,
        practiceTextId: textId,
      }),
      undefined
    )
    expect(insertRatingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userLookupId: lbId,
        rating: 'good',
        wasExplicit: false,
        wasIntroduction: true,
        practiceTextId: textId,
      }),
      undefined
    )
  })

  it('learn_new scope does NOT bypass the daily-new cap (the bypass is flashcards-only)', async () => {
    const { deps, initializeCitationFacetIfUnderDailyCap, applyFsrsResultForFacet, insertRatingEvent } = createDeps({
      claimWins: true,
    })
    initializeCitationFacetIfUnderDailyCap.mockResolvedValue(false)
    const result = await advanceReadingText(userId, textId, 'passive', 'learn_new', [], deps)
    expect(result.ok).toBe(true)
    // lb is the only learn_new-eligible annotation (la is scheduled); its
    // introduction is refused at the guard — no bypass, no FSRS, no event.
    expect(initializeCitationFacetIfUnderDailyCap).toHaveBeenCalledWith(expect.objectContaining({ bypassCap: false }))
    expect(applyFsrsResultForFacet).not.toHaveBeenCalled()
    expect(insertRatingEvent).not.toHaveBeenCalled()
    if (result.ok && !result.done) expect(result.introduced).toBe(0)
  })
})
