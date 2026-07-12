import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookupWithFacet, PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import { HARD_MAX_PRACTICE_NEW_TERMS } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import {
  composePracticeQueue,
  type ComposePracticeQueueDependencies,
  type ComposeQueueFilter,
} from './compose-practice-queue'
import { MAX_GATES_PER_COMPOSE, MAX_WARMUP_INTRO_PER_SESSION } from './leech-config'

const userId = '00000000-0000-0000-0000-000000000001'
const lang = 'es'

const id = (n: number) => `00000000-0000-0000-0000-0000000000${n.toString().padStart(2, '0')}`
const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => id(from + i))

const termRow = (lookupId: string, pool: PracticePool = 'recognition'): DbUserLookupWithFacet =>
  ({
    id: lookupId,
    user_id: userId,
    target_language: lang,
    count: 1,
    deleted_at: null,
    headword: `w-${lookupId}`,
    sense: '',
    skill: pool === 'production' ? 'meaning_production' : 'meaning_recognition',
    target_form: '',
    leech_rehab_correct_days: 0,
  }) as DbUserLookupWithFacet

const filter = (overrides: Partial<ComposeQueueFilter> = {}): ComposeQueueFilter => ({
  pools: ['production', 'recognition'],
  scope: 'both',
  render: 'both',
  autoWarmup: true,
  includeOptInNew: false,
  ...overrides,
})

const createDeps = (params: {
  // Uncredited parked backlog ids per pool (the composer's unrestricted
  // listParkedTerms call).
  backlogByPool?: Partial<Record<PracticePool, string[]>>
  // Eligible never-reviewed citation terms per pool (auto-warm-up discovery).
  eligibleNewByPool?: Partial<Record<PracticePool, string[]>>
  // Due flashcard rows per pool (repo listReviewTerms, review_due scope).
  dueByPool?: Partial<Record<PracticePool, DbUserLookupWithFacet[]>>
  // Opt-in-new flashcard rows per pool (repo listReviewTerms, learn_new scope).
  optInByPool?: Partial<Record<PracticePool, DbUserLookupWithFacet[]>>
  parkOutcomes?: Record<string, 'scaffolded' | 'cap_reached' | 'not_eligible'>
  maxNewTerms?: number
}) => {
  const listParkedTerms = vi
    .fn()
    .mockImplementation(async (p: { pool: PracticePool; restrictToUserLookupIds?: string[] }) =>
      p.restrictToUserLookupIds != null
        ? p.restrictToUserLookupIds.map((lookupId) => termRow(lookupId, p.pool))
        : (params.backlogByPool?.[p.pool] ?? []).map((lookupId) => termRow(lookupId, p.pool))
    )
  const listEligibleNewCitationFacets = vi
    .fn()
    .mockImplementation(async (p: { pool: PracticePool }) => params.eligibleNewByPool?.[p.pool] ?? [])
  const listReviewTerms = vi
    .fn()
    .mockImplementation(async (p: { pool: PracticePool; scope: string }) =>
      p.scope === 'learn_new' ? (params.optInByPool?.[p.pool] ?? []) : (params.dueByPool?.[p.pool] ?? [])
    )
  const listDueSummary = vi.fn().mockResolvedValue([{ targetLanguage: lang, newIntroducedTodayCount: 0 }])
  const allRows = new Map(
    (['production', 'recognition'] as const).flatMap((pool) =>
      [
        ...(params.backlogByPool?.[pool] ?? []),
        ...(params.eligibleNewByPool?.[pool] ?? []),
        ...(params.dueByPool?.[pool] ?? []).map((row) => row.id),
      ].map((lookupId) => [lookupId, termRow(lookupId, pool)] as const)
    )
  )
  const findByIdForUser = vi.fn().mockImplementation(async (lookupId: string) => allRows.get(lookupId) ?? null)
  // One skill-aware guard for both pools (combined daily budget).
  const initializeAndParkCitationFacetIfUnderDailyCap = vi
    .fn()
    .mockImplementation(async (p: { userLookupId: string; bypassCap?: boolean }) =>
      p.bypassCap ? 'scaffolded' : (params.parkOutcomes?.[p.userLookupId] ?? 'scaffolded')
    )
  const getPracticeLimitsForLanguage = vi
    .fn()
    .mockResolvedValue({ maxNewTerms: params.maxNewTerms ?? 20, maxReviewTerms: 100, maxReviewTermsProduction: null })
  const countReviewBudgetConsumedToday = vi.fn().mockResolvedValue(0)
  const selectNextExercise = vi.fn().mockResolvedValue(null)
  const reserveSlots = vi.fn().mockResolvedValue([])
  const listBonusForTerms = vi.fn().mockResolvedValue([])
  const countGateBankSlots = vi.fn().mockResolvedValue({ inflight: 0, failed: 0, failedTypes: 0 })

  const deps = {
    userLookupsRepository: {
      listParkedTerms,
      listEligibleNewCitationFacets,
      listReviewTerms,
      listDueSummary,
      findByIdForUser,
    },
    studyFacetsRepository: { initializeAndParkCitationFacetIfUnderDailyCap },
    userTargetLanguagePrefsRepository: { getPracticeLimitsForLanguage },
    practiceRatingEventsRepository: { countReviewBudgetConsumedToday },
    practiceExercisesRepository: { selectNextExercise, reserveSlots, listBonusForTerms, countGateBankSlots },
    usersRepository: {},
  } as unknown as ComposePracticeQueueDependencies

  return {
    deps,
    listParkedTerms,
    listEligibleNewCitationFacets,
    listReviewTerms,
    initializeAndParkCitationFacetIfUnderDailyCap,
  }
}

const callsForSkill = (guard: ReturnType<typeof vi.fn>, skill: string) =>
  guard.mock.calls.filter((c) => c[0].skill === skill)

const itemKey = (item: Awaited<ReturnType<typeof composePracticeQueue>>['items'][number]) =>
  item.type === 'flashcard' ? `flash:${item.card.id}` : `ex:${item.entry.pool}:${item.entry.userLookupId}`

describe('composePracticeQueue', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('orders items prod flashcards → prod gates → recog flashcards → recog gates → opt-in-new', async () => {
    const { deps } = createDeps({
      dueByPool: { production: [termRow(id(1), 'production')], recognition: [termRow(id(3))] },
      backlogByPool: { production: [id(2)], recognition: [id(4)] },
      optInByPool: { recognition: [termRow(id(5))] },
    })
    const result = await composePracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ includeOptInNew: true }),
      deps,
    })
    expect(result.items.map(itemKey)).toEqual([
      `flash:${id(1)}`,
      `ex:production:${id(2)}`,
      `flash:${id(3)}`,
      `ex:recognition:${id(4)}`,
      `flash:${id(5)}`,
    ])
  })

  it('pins due flashcards to review_due scope (citation-new never enters as a flashcard)', async () => {
    const { deps, listReviewTerms } = createDeps({ dueByPool: { recognition: [termRow(id(1))] } })
    await composePracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    for (const call of listReviewTerms.mock.calls) {
      expect(call[0].scope).toBe('review_due')
    }
  })

  it('plans eligible-new terms production-first under the per-session budget without parking them', async () => {
    const production = ids(10, MAX_WARMUP_INTRO_PER_SESSION + 5)
    const recognition = ids(40, 5)
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      eligibleNewByPool: { production, recognition },
    })
    const result = await composePracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    expect(initializeAndParkCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
    expect(result.items.filter((item) => item.type === 'exercise' && item.entry.pool === 'production')).toHaveLength(
      MAX_WARMUP_INTRO_PER_SESSION
    )
    expect(result.items.filter((item) => item.type === 'exercise' && item.entry.pool === 'recognition')).toHaveLength(0)
  })

  it('the backlog does NOT couple the parking budget — a full pipeline still introduces', async () => {
    const backlogSize = MAX_GATES_PER_COMPOSE - 3
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      backlogByPool: { recognition: ids(10, backlogSize) },
      eligibleNewByPool: { recognition: ids(50, 10) },
    })
    await composePracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    expect(initializeAndParkCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
  })

  it('a full backlog still introduces: newly-parked gates serve on top of the head-slice', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      backlogByPool: { recognition: ids(10, MAX_GATES_PER_COMPOSE + 5) },
      eligibleNewByPool: { recognition: ids(60, 4), production: ids(70, 2) },
    })
    const result = await composePracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    expect(initializeAndParkCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
    expect(result.items).toHaveLength(MAX_GATES_PER_COMPOSE + 6)
  })

  it('an already-spent budget plans no standard introductions and reports the limit', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      eligibleNewByPool: { recognition: [id(1), id(2)] },
      maxNewTerms: 15,
    })
    ;(deps.userLookupsRepository.listDueSummary as ReturnType<typeof vi.fn>).mockResolvedValue([
      { targetLanguage: lang, newIntroducedTodayCount: 15 },
    ])
    const result = await composePracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    expect(result.dailyLimitReached).toBe(true)
    expect(result.items).toEqual([])
    expect(initializeAndParkCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
  })

  it('learnExtraCount plans past the cap and marks only those gates for bypass on claim', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      eligibleNewByPool: { recognition: [id(1), id(2), id(3)] },
      maxNewTerms: 15,
    })
    ;(deps.userLookupsRepository.listDueSummary as ReturnType<typeof vi.fn>).mockResolvedValue([
      { targetLanguage: lang, newIntroducedTodayCount: 15 },
    ])
    const result = await composePracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ learnExtraCount: 2 }),
      deps,
    })
    expect(initializeAndParkCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
    expect(result.items.map(itemKey)).toEqual([`ex:recognition:${id(1)}`, `ex:recognition:${id(2)}`])
    expect(result.items.every((item) => item.type === 'exercise' && item.bypassDailyCap)).toBe(true)
    // The cap is still factually reached today — the flag stays true.
    expect(result.dailyLimitReached).toBe(true)
  })

  it('excludes gates already credited today (excludeCreditedToday on the backlog query)', async () => {
    const { deps, listParkedTerms } = createDeps({ backlogByPool: { recognition: [id(1)] } })
    await composePracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    const backlogCalls = listParkedTerms.mock.calls.filter((c) => c[0].restrictToUserLookupIds == null)
    expect(backlogCalls.length).toBeGreaterThan(0)
    for (const call of backlogCalls) {
      expect(call[0].excludeCreditedToday).toBe(true)
    }
  })

  it('due_only skips parking and opt-in-new but serves gates of BOTH parked origins', async () => {
    const { deps, listParkedTerms, listReviewTerms, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      backlogByPool: { recognition: [id(1)] },
      eligibleNewByPool: { recognition: [id(2)] },
      dueByPool: { recognition: [termRow(id(3))] },
      optInByPool: { recognition: [termRow(id(4))] },
    })
    const result = await composePracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ scope: 'due_only', includeOptInNew: true }),
      deps,
    })
    expect(initializeAndParkCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
    // Both origins: no parkedOrigin filter on the backlog query.
    const backlogCall = listParkedTerms.mock.calls.find((c) => c[0].restrictToUserLookupIds == null)
    expect(backlogCall?.[0].parkedOrigin).toBeUndefined()
    // Opt-in-new is an introduction — excluded from due_only even when asked.
    expect(listReviewTerms.mock.calls.every((c) => c[0].scope === 'review_due')).toBe(true)
    expect(result.items.map(itemKey)).toEqual([`flash:${id(3)}`, `ex:recognition:${id(1)}`])
  })

  it('new_only restricts gates to onboarding-parked terms and skips due flashcards', async () => {
    const { deps, listParkedTerms, listReviewTerms } = createDeps({
      backlogByPool: { recognition: [id(1)] },
      dueByPool: { recognition: [termRow(id(2))] },
    })
    const result = await composePracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ scope: 'new_only' }),
      deps,
    })
    for (const call of listParkedTerms.mock.calls) {
      expect(call[0].parkedOrigin).toBe('onboarding')
    }
    // No due flashcards fetched at all.
    expect(listReviewTerms.mock.calls.filter((c) => c[0].scope === 'review_due')).toEqual([])
    expect(result.items.map(itemKey)).toEqual([`ex:recognition:${id(1)}`])
  })

  it('flashcards_only serves no gates, runs no parking, and never queries the parked backlog', async () => {
    const { deps, listParkedTerms, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      backlogByPool: { recognition: [id(1)] },
      eligibleNewByPool: { recognition: [id(2)] },
      dueByPool: { recognition: [termRow(id(3))] },
    })
    const result = await composePracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ render: 'flashcards_only' }),
      deps,
    })
    expect(listParkedTerms).not.toHaveBeenCalled()
    expect(initializeAndParkCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
    expect(result.items.map(itemKey)).toEqual([`flash:${id(3)}`])
  })

  it('exercises_only serves no flashcards (due or opt-in)', async () => {
    const { deps, listReviewTerms } = createDeps({
      backlogByPool: { recognition: [id(1)] },
      dueByPool: { recognition: [termRow(id(2))] },
      optInByPool: { recognition: [termRow(id(3))] },
    })
    const result = await composePracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ render: 'exercises_only', includeOptInNew: true }),
      deps,
    })
    expect(listReviewTerms).not.toHaveBeenCalled()
    expect(result.items.map(itemKey)).toEqual([`ex:recognition:${id(1)}`])
  })

  it('opt-in-new pass pins the citation-new bucket to 0 and uses the hard ceiling for opt-in facets', async () => {
    const { deps, listReviewTerms } = createDeps({ optInByPool: { recognition: [termRow(id(1))] } })
    await composePracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ includeOptInNew: true, render: 'flashcards_only' }),
      deps,
    })
    const optInCalls = listReviewTerms.mock.calls.filter((c) => c[0].scope === 'learn_new')
    expect(optInCalls).toHaveLength(2) // one per pool
    for (const call of optInCalls) {
      expect(call[0].maxNewTerms).toBe(0)
      expect(call[0].maxOptInNewTerms).toBe(HARD_MAX_PRACTICE_NEW_TERMS)
    }
  })

  it('pool subset: pools=[production] touches only the production pool', async () => {
    const { deps, listParkedTerms, listEligibleNewCitationFacets, initializeAndParkCitationFacetIfUnderDailyCap } =
      createDeps({
        backlogByPool: { production: [id(1)], recognition: [id(2)] },
        eligibleNewByPool: { production: [id(3)], recognition: [id(4)] },
        dueByPool: { production: [termRow(id(5), 'production')], recognition: [termRow(id(6))] },
      })
    const result = await composePracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ pools: ['production'] }),
      deps,
    })
    for (const call of [...listParkedTerms.mock.calls, ...listEligibleNewCitationFacets.mock.calls]) {
      expect(call[0].pool).toBe('production')
    }
    expect(callsForSkill(initializeAndParkCitationFacetIfUnderDailyCap, 'meaning_recognition')).toHaveLength(0)
    expect(result.items.map(itemKey)).toEqual([`flash:${id(5)}`, `ex:production:${id(1)}`, `ex:production:${id(3)}`])
  })

  it('marks newly-parked gates isNewIntroduction=true and backlog gates false', async () => {
    const { deps } = createDeps({
      backlogByPool: { recognition: [id(1)] },
      eligibleNewByPool: { recognition: [id(2)] },
    })
    const result = await composePracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    const flags = new Map(
      result.items.flatMap((item) =>
        item.type === 'exercise' ? [[item.entry.userLookupId, item.isNewIntroduction]] : []
      )
    )
    expect(flags.get(id(1))).toBe(false)
    expect(flags.get(id(2))).toBe(true)
  })

  it('flags dailyLimitReached when the budget is pre-exhausted (no pass runs) and candidates remain', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      eligibleNewByPool: { recognition: ids(10, 5) },
      maxNewTerms: 15,
    })
    // All 15 introductions already consumed today.
    ;(deps.userLookupsRepository.listDueSummary as ReturnType<typeof vi.fn>).mockResolvedValue([
      { targetLanguage: lang, newIntroducedTodayCount: 15 },
    ])
    const result = await composePracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    expect(result.dailyLimitReached).toBe(true)
    expect(result.canLearnExtra).toBe(true)
    expect(initializeAndParkCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
  })

  it('serve-only re-entry (autoWarmup=false) parks nothing and re-serves the same backlog', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = createDeps({
      backlogByPool: { recognition: [id(1), id(2)] },
      eligibleNewByPool: { recognition: [id(3)] },
    })
    const result = await composePracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ autoWarmup: false }),
      deps,
    })
    expect(initializeAndParkCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
    expect(result.items.map(itemKey)).toEqual([`ex:recognition:${id(1)}`, `ex:recognition:${id(2)}`])
    expect(result.dailyLimitReached).toBe(false)
  })
})
