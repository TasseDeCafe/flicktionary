import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
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

const createDeps = (opts: { claimWins: boolean }) => {
  // la is already scheduled (review); lb is new — so rating both should
  // introduce exactly one term.
  const lookupsByKey: Record<string, DbUserLookup> = {
    [`${laId}::s`]: makeLookup(laId, { srs_state: 'review', srs_due: '2026-05-12T00:00:00Z' }),
    [`${lbId}::s`]: makeLookup(lbId),
  }
  const findByKey = vi.fn(
    async ({ headword, sense }: { headword: string; sense: string }) => lookupsByKey[`${headword}::${sense}`] ?? null
  )
  const applyFsrsResultForPool = vi.fn().mockResolvedValue(undefined)
  const initializeSrsStateIfUnderDailyCap = vi.fn().mockResolvedValue(true)
  const parkLeech = vi.fn().mockResolvedValue(undefined)
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
      initializeSrsStateIfUnderDailyCap,
      initializeSrsStateForPool: vi.fn(),
      applyFsrsResultForPool,
      parkLeech,
      listReviewTerms: vi.fn().mockResolvedValue([]),
      listDueSummary: vi.fn().mockResolvedValue([]),
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
    applyFsrsResultForPool,
    claimFinalize,
    selectAndMarkReading,
    parkLeech,
    insertRatingEvent,
    initializeSrsStateIfUnderDailyCap,
  }
}

describe('advanceReadingText', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('applies the explicit rating to tapped terms and implicit good to the rest, counting introductions', async () => {
    const { deps, applyFsrsResultForPool } = createDeps({ claimWins: true })
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
    expect(applyFsrsResultForPool).toHaveBeenCalledTimes(2)
  })

  it('is idempotent: a lost finalize claim applies no FSRS and still returns the next text', async () => {
    const { deps, applyFsrsResultForPool, findByKey } = createDeps({ claimWins: false })
    const result = await advanceReadingText(userId, textId, 'passive', 'mixed', [], deps)
    expect(result).toEqual({ ok: true, done: false, practiceText: nextText, introduced: 0 })
    expect(applyFsrsResultForPool).not.toHaveBeenCalled()
    expect(findByKey).not.toHaveBeenCalled()
  })

  it('skips annotations already reviewed after the text was prepared', async () => {
    const { deps, applyFsrsResultForPool } = createDeps({ claimWins: true })
    ;(deps.practiceTextsRepository.claimFinalize as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...claimedText,
      ready_at: '2026-05-12T00:00:00Z',
    })
    ;(deps.userLookupsRepository.findByKey as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ headword, sense }: { headword: string; sense: string }) => {
        if (headword === laId) {
          return makeLookup(laId, {
            srs_state: 'review',
            srs_due: '2026-05-12T00:00:00Z',
            srs_last_review: '2026-05-12T00:05:00Z',
          })
        }
        return makeLookup(lbId)
      }
    )

    const result = await advanceReadingText(userId, textId, 'passive', 'mixed', [], deps)

    expect(result).toEqual({ ok: true, done: false, practiceText: nextText, introduced: 1 })
    expect(applyFsrsResultForPool).toHaveBeenCalledTimes(1)
    expect(applyFsrsResultForPool).toHaveBeenCalledWith(expect.objectContaining({ userLookupId: lbId }), undefined)
  })

  it('does not mutate FSRS for parked annotations from stale generated texts', async () => {
    const { deps, applyFsrsResultForPool, parkLeech } = createDeps({ claimWins: true })
    ;(deps.userLookupsRepository.findByKey as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ headword }: { headword: string }) => {
        if (headword === laId) {
          return makeLookup(laId, {
            srs_state: 'review',
            srs_due: '2026-05-12T00:00:00Z',
            leech_parked_at: '2026-05-12T00:01:00Z',
          })
        }
        return makeLookup(lbId)
      }
    )

    const result = await advanceReadingText(userId, textId, 'passive', 'mixed', [], deps)

    expect(result).toEqual({ ok: true, done: false, practiceText: nextText, introduced: 1 })
    expect(applyFsrsResultForPool).toHaveBeenCalledTimes(1)
    expect(applyFsrsResultForPool).toHaveBeenCalledWith(expect.objectContaining({ userLookupId: lbId }), undefined)
    expect(parkLeech).not.toHaveBeenCalled()
  })

  it("parks a leech when a reading-mode 'again' rating crosses the lapse threshold", async () => {
    const { deps, parkLeech } = createDeps({ claimWins: true })
    ;(deps.userLookupsRepository.findByKey as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ headword }: { headword: string }) => {
        if (headword === laId) {
          // One lapse away from the threshold (4); the explicit 'again' below
          // is the fresh lapse that parks it.
          return makeLookup(laId, {
            srs_state: 'review',
            srs_due: '2026-05-12T00:00:00Z',
            srs_stability: 5,
            srs_difficulty: 6,
            srs_last_review: '2026-05-01T00:00:00Z',
            srs_reps: 8,
            srs_lapses: 3,
          })
        }
        return makeLookup(lbId)
      }
    )

    const result = await advanceReadingText(
      userId,
      textId,
      'passive',
      'mixed',
      [{ userLookupId: laId, rating: 'again' }],
      deps
    )

    expect(result.ok).toBe(true)
    expect(parkLeech).toHaveBeenCalledWith({ userLookupId: laId, pool: 'passive' })
    // The implicit-good term (lb) must not park.
    expect(parkLeech).toHaveBeenCalledTimes(1)
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
    const { deps, initializeSrsStateIfUnderDailyCap, applyFsrsResultForPool, insertRatingEvent } = createDeps({
      claimWins: true,
    })
    initializeSrsStateIfUnderDailyCap.mockResolvedValue(false)
    const result = await advanceReadingText(userId, textId, 'passive', 'learn_new', [], deps)
    expect(result.ok).toBe(true)
    // lb is the only learn_new-eligible annotation (la is scheduled); its
    // introduction is refused at the guard — no bypass, no FSRS, no event.
    expect(initializeSrsStateIfUnderDailyCap).toHaveBeenCalledWith(expect.objectContaining({ bypassCap: false }))
    expect(applyFsrsResultForPool).not.toHaveBeenCalled()
    expect(insertRatingEvent).not.toHaveBeenCalled()
    if (result.ok && !result.done) expect(result.introduced).toBe(0)
  })
})
