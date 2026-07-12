import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookupWithFacet, PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { ComposeQueueFilter } from './compose-practice-queue'
import { MAX_GATES_PER_COMPOSE, MAX_WARMUP_INTRO_PER_SESSION } from './leech-config'
import { planPracticeQueue, type PlanPracticeQueueDependencies } from './plan-practice-queue'

const userId = '00000000-0000-0000-0000-000000000001'
const lang = 'es'

const id = (n: number) => `00000000-0000-0000-0000-0000000000${n.toString().padStart(2, '0')}`
const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => id(from + i))

const termRow = (
  lookupId: string,
  pool: PracticePool = 'recognition',
  srsState: string | null = null
): DbUserLookupWithFacet =>
  ({
    id: lookupId,
    user_id: userId,
    target_language: lang,
    headword: `w-${lookupId}`,
    sense: '',
    skill: pool === 'production' ? 'meaning_production' : 'meaning_recognition',
    target_form: '',
    srs_state: srsState,
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
  // Backlog rows per pool; srs_state drives the origin split (NULL =
  // onboarding, else leech).
  backlogByPool?: Partial<Record<PracticePool, DbUserLookupWithFacet[]>>
  eligibleNewByPool?: Partial<Record<PracticePool, string[]>>
  dueByPool?: Partial<Record<PracticePool, DbUserLookupWithFacet[]>>
  maxNewTerms?: number
  introducedToday?: number
}) => {
  const listParkedTerms = vi
    .fn()
    .mockImplementation(async (p: { pool: PracticePool }) => params.backlogByPool?.[p.pool] ?? [])
  const listEligibleNewCitationFacets = vi
    .fn()
    .mockImplementation(async (p: { pool: PracticePool }) => params.eligibleNewByPool?.[p.pool] ?? [])
  const listReviewTerms = vi
    .fn()
    .mockImplementation(async (p: { pool: PracticePool }) => params.dueByPool?.[p.pool] ?? [])
  const listDueSummary = vi
    .fn()
    .mockResolvedValue([{ targetLanguage: lang, newIntroducedTodayCount: params.introducedToday ?? 0 }])
  const getPracticeLimitsForLanguage = vi
    .fn()
    .mockResolvedValue({ maxNewTerms: params.maxNewTerms ?? 20, maxReviewTerms: 100, maxReviewTermsProduction: null })
  const countReviewBudgetConsumedToday = vi.fn().mockResolvedValue(0)

  const deps = {
    userLookupsRepository: { listParkedTerms, listEligibleNewCitationFacets, listReviewTerms, listDueSummary },
    userTargetLanguagePrefsRepository: { getPracticeLimitsForLanguage },
    practiceRatingEventsRepository: { countReviewBudgetConsumedToday },
  } as unknown as PlanPracticeQueueDependencies

  return { deps, listParkedTerms, listEligibleNewCitationFacets, listReviewTerms }
}

describe('planPracticeQueue', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('allocates the shared park budget sequentially — production first, never double-counted', async () => {
    const { deps } = createDeps({
      eligibleNewByPool: { production: ids(10, 6), recognition: ids(30, 10) },
    })
    const plan = await planPracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    const production = plan.perPool.find((p) => p.pool === 'production')!
    const recognition = plan.perPool.find((p) => p.pool === 'recognition')!
    expect(plan.parkBudget).toBe(MAX_WARMUP_INTRO_PER_SESSION)
    expect(production.plannedIntroductionCount).toBe(6)
    // Recognition gets only the remainder of the SHARED budget (10 − 6 = 4),
    // not its own min(budget, candidates).
    expect(recognition.plannedIntroductionCount).toBe(4)
  })

  it('the park budget ignores the backlog and is bounded by the remaining daily budget', async () => {
    const withBacklog = await planPracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter(),
      deps: createDeps({
        backlogByPool: { recognition: ids(10, MAX_GATES_PER_COMPOSE - 3).map((i) => termRow(i)) },
        eligibleNewByPool: { recognition: ids(50, 10) },
      }).deps,
    })
    // A 17-gate backlog no longer starves introductions.
    expect(withBacklog.parkBudget).toBe(MAX_WARMUP_INTRO_PER_SESSION)
    expect(withBacklog.perPool.find((p) => p.pool === 'recognition')!.plannedIntroductionCount).toBe(10)

    const lowBudget = await planPracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter(),
      deps: createDeps({ eligibleNewByPool: { recognition: ids(50, 10) }, maxNewTerms: 20, introducedToday: 17 }).deps,
    })
    // remaining 3 bounds the session's introductions.
    expect(lowBudget.parkBudget).toBe(3)
    expect(lowBudget.perPool.find((p) => p.pool === 'recognition')!.plannedIntroductionCount).toBe(3)
  })

  it('head-slices the backlog to MAX_GATES_PER_COMPOSE across pools, production first, and splits served origins', async () => {
    const productionBacklog = ids(10, 8).map((i) => termRow(i, 'production', null))
    const recognitionBacklog = [
      ...ids(30, 10).map((i) => termRow(i, 'recognition', null)),
      ...ids(50, 10).map((i) => termRow(i, 'recognition', 'review')),
    ]
    const { deps } = createDeps({
      backlogByPool: { production: productionBacklog, recognition: recognitionBacklog },
    })
    const plan = await planPracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    const production = plan.perPool.find((p) => p.pool === 'production')!
    const recognition = plan.perPool.find((p) => p.pool === 'recognition')!
    expect(production.backlogServedIds).toHaveLength(8)
    expect(recognition.backlogServedIds).toHaveLength(MAX_GATES_PER_COMPOSE - 8)
    // The recognition slice takes the head of the list: 10 onboarding rows
    // first, then 2 leech rows.
    expect(recognition.backlogServedOnboardingCount).toBe(10)
    expect(recognition.backlogServedLeechCount).toBe(2)
  })

  it('classifies the actual due rows by srs_state (form/pronunciation facets included, unlike the summary)', async () => {
    const { deps } = createDeps({
      dueByPool: {
        recognition: [
          termRow(id(1), 'recognition', 'review'),
          termRow(id(2), 'recognition', 'new'),
          termRow(id(3), 'recognition', 'learning'),
          termRow(id(4), 'recognition', 'relearning'),
        ],
      },
    })
    const plan = await planPracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    const recognition = plan.perPool.find((p) => p.pool === 'recognition')!
    expect(recognition.dueRows.map((r) => r.srs_state)).toEqual(['review', 'new', 'learning', 'relearning'])
  })

  it('predicts dailyLimitReached when the budget is already exhausted and candidates remain', async () => {
    const { deps } = createDeps({
      eligibleNewByPool: { recognition: ids(10, 5) },
      maxNewTerms: 15,
      introducedToday: 15,
    })
    const plan = await planPracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    expect(plan.dailyBudget).toEqual({ max: 15, introducedToday: 15, remaining: 0 })
    expect(plan.dailyLimitReached).toBe(true)
    expect(plan.perPool.find((p) => p.pool === 'recognition')!.plannedIntroductionCount).toBe(0)
  })

  it('does not flag the daily limit when session PACING (not the budget) stops at 10', async () => {
    const { deps } = createDeps({ eligibleNewByPool: { recognition: ids(10, 30) }, maxNewTerms: 20 })
    const plan = await planPracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    // 10 of 20 budget slots used; candidates remain but tomorrow isn't needed
    // — the next compose introduces more TODAY.
    expect(plan.parkBudget).toBe(MAX_WARMUP_INTRO_PER_SESSION)
    expect(plan.dailyLimitReached).toBe(false)
  })

  it('flags the daily limit when the last budget slots are consumed with candidates left', async () => {
    const { deps } = createDeps({
      eligibleNewByPool: { production: ids(10, 2), recognition: ids(30, 6) },
      maxNewTerms: 20,
      introducedToday: 15,
    })
    const plan = await planPracticeQueue({ userId, targetLanguage: lang, filter: filter(), deps })
    // remaining 5: production takes 2, recognition 3; candidates remain -> the
    // budget is spent after this compose.
    expect(plan.perPool.find((p) => p.pool === 'production')!.plannedIntroductionCount).toBe(2)
    expect(plan.perPool.find((p) => p.pool === 'recognition')!.plannedIntroductionCount).toBe(3)
    expect(plan.dailyLimitReached).toBe(true)
  })

  it('canLearnExtra: recognition candidates beyond the planned introductions', async () => {
    const yes = await planPracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter(),
      deps: createDeps({ eligibleNewByPool: { recognition: ids(10, 12) }, maxNewTerms: 5 }).deps,
    })
    expect(yes.canLearnExtra).toBe(true)

    const no = await planPracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter(),
      deps: createDeps({ eligibleNewByPool: { recognition: ids(10, 3) } }).deps,
    })
    expect(no.canLearnExtra).toBe(false)
  })

  it('learn-extra plans past the cap without duplicating the normal introductions', async () => {
    const candidates = ids(10, 8)
    const { deps } = createDeps({
      eligibleNewByPool: { recognition: candidates },
      maxNewTerms: 20,
      introducedToday: 18,
    })
    const plan = await planPracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ learnExtraCount: 4 }),
      deps,
    })
    const recognition = plan.perPool.find((p) => p.pool === 'recognition')!
    // Normal pass takes the remaining budget (2); extras take the NEXT 4
    // candidates — no overlap, exact requested count, past the cap.
    expect(plan.parkBudget).toBe(2)
    expect(recognition.plannedIntroductionCount).toBe(2)
    expect(recognition.plannedExtraIntroductionIds).toEqual(candidates.slice(2, 6))
  })

  it('serve-only and due_only plans park nothing and fetch no candidates', async () => {
    for (const f of [filter({ autoWarmup: false }), filter({ scope: 'due_only' })]) {
      const { deps, listEligibleNewCitationFacets } = createDeps({
        eligibleNewByPool: { recognition: ids(10, 5) },
      })
      const plan = await planPracticeQueue({ userId, targetLanguage: lang, filter: f, deps })
      expect(listEligibleNewCitationFacets).not.toHaveBeenCalled()
      expect(plan.parkBudget).toBe(0)
      expect(plan.dailyLimitReached).toBe(false)
      expect(plan.canLearnExtra).toBe(false)
    }
  })

  it('flashcards_only never queries the backlog; exercises_only never fetches due rows', async () => {
    const flashcardsOnly = createDeps({ backlogByPool: { recognition: [termRow(id(1))] } })
    await planPracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ render: 'flashcards_only' }),
      deps: flashcardsOnly.deps,
    })
    expect(flashcardsOnly.listParkedTerms).not.toHaveBeenCalled()

    const exercisesOnly = createDeps({ dueByPool: { recognition: [termRow(id(2), 'recognition', 'review')] } })
    const plan = await planPracticeQueue({
      userId,
      targetLanguage: lang,
      filter: filter({ render: 'exercises_only' }),
      deps: exercisesOnly.deps,
    })
    expect(exercisesOnly.listReviewTerms).not.toHaveBeenCalled()
    expect(plan.perPool.every((p) => p.dueRows.length === 0)).toBe(true)
  })
})
