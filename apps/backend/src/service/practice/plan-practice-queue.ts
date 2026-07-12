import type { DbUserLookupWithFacet, PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { ComposeQueueFilter } from './compose-practice-queue'
import { MAX_GATES_PER_COMPOSE, MAX_WARMUP_INTRO_PER_SESSION } from './leech-config'
import { listReviewTerms, type ListReviewTermsDependencies } from './list-review-terms'
import { clampPracticeSessionLimits } from './review-caps'

// Production first: production volume is inherently low, so front-loading it
// keeps it from being buried behind recognition work — that ordering (not a
// separate UI surface) is the production-protection mechanism.
export const POOL_ORDER: PracticePool[] = ['production', 'recognition']

export type PlanPracticeQueueDependencies = ListReviewTermsDependencies

export type PoolQueuePlan = {
  pool: PracticePool
  // The exact due-flashcard rows this compose serves (the repo's bucketed,
  // budget-capped selection — these include form/pronunciation facets, which
  // the citation-only due summary cannot see). Empty when the filter excludes
  // flashcards.
  dueRows: DbUserLookupWithFacet[]
  // Uncredited parked backlog in serve order (oldest-parked first), and the
  // slice of it that fits this compose's cross-pool gate budget.
  backlogIds: string[]
  backlogServedIds: string[]
  backlogServedOnboardingCount: number
  backlogServedLeechCount: number
  // Eligible never-introduced citation terms, introduction-ordered. Empty when
  // the filter rules parking out.
  introCandidateIds: string[]
  // How many of introCandidateIds this compose would introduce, from the
  // SEQUENTIAL allocation of the shared park budget (production first,
  // recognition under the daily budget) — never a per-pool min() over the
  // shared budget, which would double-count it.
  plannedIntroductionCount: number
  // Explicit learn-extra introductions (recognition only): past the daily cap
  // and the park budget, excluding the terms the normal pass already takes.
  plannedExtraIntroductionIds: string[]
}

export type PracticeQueuePlan = {
  // The daily-new budget (recognition citation introductions).
  dailyBudget: { max: number; introducedToday: number; remaining: number }
  // The coupled per-compose parking budget:
  // min(MAX_WARMUP_INTRO_PER_SESSION, gate slots left after the backlog).
  parkBudget: number
  // Predicted: the recognition parking pass would run into the daily cap with
  // candidates left over. Compose ORs this with the transactional cap_reached
  // outcome (races can make the two differ).
  dailyLimitReached: boolean
  // Recognition intro candidates remain beyond the planned introductions, so
  // a learn-extra request (bypassCap) has something to serve.
  canLearnExtra: boolean
  perPool: PoolQueuePlan[]
}

// The read-only selection/budget arithmetic behind one composed practice
// queue. composePracticeQueue executes this plan (running the parking
// mutations and fetching exercises); the preview endpoint returns its counts
// directly — one function, so the plan card and the session can't disagree.
export const planPracticeQueue = async (params: {
  userId: string
  targetLanguage: string
  filter: ComposeQueueFilter
  deps: PlanPracticeQueueDependencies
}): Promise<PracticeQueuePlan> => {
  const { userId, targetLanguage, filter, deps } = params
  const pools = POOL_ORDER.filter((pool) => filter.pools.includes(pool))
  const wantFlashcards = filter.render !== 'exercises_only'
  const wantExercises = filter.render !== 'flashcards_only'
  // 'new_only' means warm-up work: gates for onboarding-parked terms only.
  // Every other scope serves BOTH parked origins — an onboarding term's
  // introduction already happened at parking time, so its gate is committed
  // due work exactly like a leech's rehab gate.
  const gateParkedOrigin = filter.scope === 'new_only' ? ('onboarding' as const) : undefined
  const runParking = filter.autoWarmup && wantExercises && filter.scope !== 'due_only'

  // Daily-new budget. The clamped limit is also what the atomic park guard
  // compares its own today-count against, so compose passes dailyBudget.max
  // through to the pass.
  const clamped = clampPracticeSessionLimits(
    await deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(userId, targetLanguage)
  )
  const summary = (await deps.userLookupsRepository.listDueSummary(userId)).find(
    (s) => s.targetLanguage === targetLanguage
  )
  const introducedToday = summary?.newIntroducedTodayCount ?? 0
  const dailyBudget = {
    max: clamped.maxNewTerms,
    introducedToday,
    remaining: Math.max(0, clamped.maxNewTerms - introducedToday),
  }

  // Backlog of already-parked terms still servable today (rows, not ids: the
  // origin split below reads srs_state — NULL = onboarding, else leech).
  const backlogRowsByPool = new Map<PracticePool, DbUserLookupWithFacet[]>()
  for (const pool of pools) {
    if (!wantExercises) {
      backlogRowsByPool.set(pool, [])
      continue
    }
    const rows = await deps.userLookupsRepository.listParkedTerms({
      userId,
      targetLanguage,
      pool,
      parkedOrigin: gateParkedOrigin,
      excludeCreditedToday: true,
    })
    backlogRowsByPool.set(pool, rows)
  }
  const backlogCount = [...backlogRowsByPool.values()].reduce((n, rows) => n + rows.length, 0)

  const parkBudget = runParking
    ? Math.max(0, Math.min(MAX_WARMUP_INTRO_PER_SESSION, MAX_GATES_PER_COMPOSE - backlogCount))
    : 0

  // Intro candidates per pool (introduction-ordered). Recognition candidates
  // are needed even at parkBudget 0 — learn-extra and canLearnExtra read them.
  const introCandidatesByPool = new Map<PracticePool, string[]>()
  for (const pool of pools) {
    introCandidatesByPool.set(
      pool,
      runParking ? await deps.userLookupsRepository.listEligibleNewCitationFacets({ userId, targetLanguage, pool }) : []
    )
  }

  // Sequential allocation of the shared park budget: production first,
  // recognition takes what's left, additionally bounded by the daily budget.
  const productionCandidates = introCandidatesByPool.get('production') ?? []
  const recognitionCandidates = introCandidatesByPool.get('recognition') ?? []
  const plannedProduction = Math.min(parkBudget, productionCandidates.length)
  const parkBudgetAfterProduction = parkBudget - plannedProduction
  const plannedRecognition = Math.min(parkBudgetAfterProduction, dailyBudget.remaining, recognitionCandidates.length)

  // Predicted cap hit: the recognition pass attempts min(budget-slots,
  // candidates) parks and the (remaining+1)-th attempt is refused. This
  // mirrors the transactional pass exactly, so on the race-free path
  // prediction and outcome agree.
  const dailyLimitReached = Math.min(parkBudgetAfterProduction, recognitionCandidates.length) > dailyBudget.remaining

  const plannedExtraIntroductionIds =
    runParking && filter.learnExtraCount != null && filter.learnExtraCount > 0
      ? recognitionCandidates.slice(plannedRecognition, plannedRecognition + filter.learnExtraCount)
      : []

  const canLearnExtra = runParking && pools.includes('recognition') && recognitionCandidates.length > plannedRecognition

  // Cross-pool gate head-slice: MAX_GATES_PER_COMPOSE serve slots, production
  // first, oldest-parked kept (listParkedTerms returns oldest first). Newly
  // parked terms are always served ON TOP of this slice — the coupled park
  // budget already reserved their slots.
  let backlogSlotsLeft = MAX_GATES_PER_COMPOSE
  const perPool: PoolQueuePlan[] = []
  for (const pool of pools) {
    const backlogRows = backlogRowsByPool.get(pool) ?? []
    const servedRows = backlogRows.slice(0, backlogSlotsLeft)
    backlogSlotsLeft -= servedRows.length
    const dueRows =
      wantFlashcards && filter.scope !== 'new_only'
        ? await listReviewTerms(userId, targetLanguage, pool, 'review_due', deps)
        : []
    perPool.push({
      pool,
      dueRows,
      backlogIds: backlogRows.map((row) => row.id),
      backlogServedIds: servedRows.map((row) => row.id),
      backlogServedOnboardingCount: servedRows.filter((row) => row.srs_state == null).length,
      backlogServedLeechCount: servedRows.filter((row) => row.srs_state != null).length,
      introCandidateIds: introCandidatesByPool.get(pool) ?? [],
      plannedIntroductionCount:
        pool === 'production' ? plannedProduction : pool === 'recognition' ? plannedRecognition : 0,
      plannedExtraIntroductionIds: pool === 'recognition' ? plannedExtraIntroductionIds : [],
    })
  }

  return { dailyBudget, parkBudget, dailyLimitReached, canLearnExtra, perPool }
}
