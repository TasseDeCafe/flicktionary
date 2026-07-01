import type { DbUserLookupWithFacet, PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { HARD_MAX_PRACTICE_NEW_TERMS } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { StrengthenExerciseEntry, ExerciseBankDependencies } from './exercise-bank'
import { getStrengthenExercises } from './exercise-bank'
import { MAX_GATES_PER_COMPOSE, MAX_WARMUP_INTRO_PER_SESSION } from './leech-config'
import { listReviewTerms } from './list-review-terms'
import { clampPracticeSessionLimits } from './review-caps'
import { runProductionParkingPass, runRecognitionParkingPass } from './warmup-parking'

export type ComposePracticeQueueDependencies = ExerciseBankDependencies & {
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
}

// Which terms are in scope, and how they render. Render type is DERIVED from
// term state, never chosen per item: a parked term is a gate exercise, a
// graduated (or due) term is a flashcard, a new opt-in facet is a flashcard.
// The filter only selects which of those populations participate.
export type ComposeQueueFilter = {
  pools: PracticePool[]
  // 'due_only' skips the parking pass and the opt-in-new pass entirely;
  // 'new_only' skips due flashcards and restricts gates to onboarding-parked
  // terms (warm-up gates — a leech's rehab is due work, not new work).
  scope: 'due_only' | 'new_only' | 'both'
  render: 'flashcards_only' | 'exercises_only' | 'both'
  // Park eligible new terms into warm-up before serving (the "no new citation
  // flashcards" on-ramp). Refresh forces this off server-side.
  autoWarmup: boolean
  // Serve never-reviewed opt-in (non-citation) facets — pronunciation and
  // form cards — as flashcards. They never park (the exercise bank has no
  // facet identity), so this pass is their ONLY introduction path; it is
  // reserved for the explicit Learn-new preset, mirroring the old rule that
  // opt-in new facets are served only in learn_new scope, never mixed.
  includeOptInNew: boolean
  // Explicit "learn extra" request: park up to this many more recognition
  // terms past the daily-new cap (bypassCap). They still stamp introduced_at.
  learnExtraCount?: number
}

export type ComposedQueueItem =
  | { type: 'flashcard'; card: DbUserLookupWithFacet }
  | { type: 'exercise'; entry: StrengthenExerciseEntry }

export type ComposePracticeQueueResult = {
  items: ComposedQueueItem[]
  dailyLimitReached: boolean
}

// Production first: production volume is inherently low, so front-loading it
// keeps it from being buried behind recognition work — that ordering (not a
// separate UI surface) is the production-protection mechanism. The final queue
// is a pure concatenation of deterministically-ordered sub-lists
// (prod flashcards → prod gates → recog flashcards → recog gates → opt-in-new),
// so the same inputs always compose the same snapshot.
const POOL_ORDER: PracticePool[] = ['production', 'recognition']

// One composed practice queue: gate exercises for parked terms (warm-up +
// rehab) interleaved with due flashcards, production first. Composing is a
// MUTATION when autoWarmup is on — it parks eligible new terms (stamping
// introduced_at, consuming the daily-new budget) before serving. The coupled
// budget guarantees a compose never parks more terms than it can serve in the
// same session, so opening Practice and leaving never burns budget on terms
// the user was never shown.
export const composePracticeQueue = async (params: {
  userId: string
  targetLanguage: string
  filter: ComposeQueueFilter
  deps: ComposePracticeQueueDependencies
}): Promise<ComposePracticeQueueResult> => {
  const { userId, targetLanguage, filter, deps } = params
  const pools = POOL_ORDER.filter((pool) => filter.pools.includes(pool))
  const wantFlashcards = filter.render !== 'exercises_only'
  const wantExercises = filter.render !== 'flashcards_only'
  // 'new_only' means warm-up work: gates for onboarding-parked terms only.
  // Every other scope serves BOTH parked origins — an onboarding term's
  // introduction already happened at parking time, so its gate is committed
  // due work exactly like a leech's rehab gate (excluding either would
  // re-create the stranded-lane problem the composed queue exists to fix).
  const gateParkedOrigin = filter.scope === 'new_only' ? ('onboarding' as const) : undefined

  // Backlog of already-parked terms still servable today. Terms whose rehab
  // day-credit was already earned are excluded outright: a gate answered twice
  // on one calendar day consumes a banked (Opus-generated) exercise while
  // advancing nothing.
  const backlogByPool = new Map<PracticePool, string[]>()
  for (const pool of pools) {
    if (!wantExercises) {
      backlogByPool.set(pool, [])
      continue
    }
    const rows = await deps.userLookupsRepository.listParkedTerms({
      userId,
      targetLanguage,
      pool,
      parkedOrigin: gateParkedOrigin,
      excludeCreditedToday: true,
    })
    backlogByPool.set(
      pool,
      rows.map((row) => row.id)
    )
  }

  // Parking pass (auto-warm-up). Coupled budget: park at most
  // min(MAX_WARMUP_INTRO_PER_SESSION, gate-serve slots left after the
  // backlog) so nothing gets parked that this compose can't also serve.
  // Production parks first (same rationale as the serve order); recognition
  // eats what's left under its daily-new cap.
  let dailyLimitReached = false
  const newlyParkedByPool = new Map<PracticePool, string[]>()
  const runParking = filter.autoWarmup && wantExercises && filter.scope !== 'due_only'
  if (runParking) {
    const backlogCount = [...backlogByPool.values()].reduce((n, ids) => n + ids.length, 0)
    let parkBudget = Math.max(0, Math.min(MAX_WARMUP_INTRO_PER_SESSION, MAX_GATES_PER_COMPOSE - backlogCount))
    if (pools.includes('production') && parkBudget > 0) {
      const candidates = await deps.userLookupsRepository.listEligibleNewCitationFacets({
        userId,
        targetLanguage,
        pool: 'production',
      })
      const pass = await runProductionParkingPass({
        userId,
        targetLanguage,
        candidateUserLookupIds: candidates,
        maxCount: parkBudget,
        deps,
      })
      newlyParkedByPool.set('production', pass.scaffolded)
      parkBudget -= pass.scaffolded.length
    }
    if (pools.includes('recognition')) {
      const candidates = await deps.userLookupsRepository.listEligibleNewCitationFacets({
        userId,
        targetLanguage,
        pool: 'recognition',
      })
      // The FULL clamped per-language daily-new cap — the atomic park method
      // does its own today-count comparison against it.
      const maxNewTerms = clampPracticeSessionLimits(
        await deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(userId, targetLanguage)
      ).maxNewTerms
      if (parkBudget > 0) {
        const pass = await runRecognitionParkingPass({
          userId,
          targetLanguage,
          candidateUserLookupIds: candidates,
          maxNewTerms,
          maxCount: parkBudget,
          deps,
        })
        newlyParkedByPool.set('recognition', pass.scaffolded)
        dailyLimitReached = pass.dailyLimitReached
      }
      // Learn extra: the user explicitly asked for N more, so this pass
      // ignores both the daily cap (bypassCap) and the coupled budget — the
      // extra gates are always served, even past MAX_GATES_PER_COMPOSE.
      if (filter.learnExtraCount != null && filter.learnExtraCount > 0) {
        const alreadyParked = new Set(newlyParkedByPool.get('recognition') ?? [])
        const extra = await runRecognitionParkingPass({
          userId,
          targetLanguage,
          candidateUserLookupIds: candidates.filter((id) => !alreadyParked.has(id)),
          maxNewTerms,
          maxCount: filter.learnExtraCount,
          bypassCap: true,
          deps,
        })
        newlyParkedByPool.set('recognition', [...(newlyParkedByPool.get('recognition') ?? []), ...extra.scaffolded])
      }
    }
  }

  const items: ComposedQueueItem[] = []
  // Serve budget for gates from the pre-existing backlog. Newly-parked terms
  // are always served on top (the coupled parking budget already reserved
  // their slots; learn-extra may exceed the cap — an explicit user request).
  let backlogSlotsLeft = MAX_GATES_PER_COMPOSE

  for (const pool of pools) {
    if (wantFlashcards && filter.scope !== 'new_only') {
      // 'review_due' is load-bearing: citation-new terms must NEVER enter the
      // composed queue as flashcards (they enter via warm-up gates), and the
      // repo forces the citation-new bucket's limit to 0 outside learn_new
      // scope. The opt-in-new pass below is the one deliberate exception.
      const due = await listReviewTerms(userId, targetLanguage, pool, 'review_due', deps)
      items.push(...due.map((card) => ({ type: 'flashcard' as const, card })))
    }
    if (wantExercises) {
      const newlyParked = newlyParkedByPool.get(pool) ?? []
      const backlogIds = backlogByPool.get(pool) ?? []
      // listParkedTerms returns oldest-parked first, so slicing the head keeps
      // the longest-waiting gates; getStrengthenExercises re-orders the merged
      // set the same way.
      const backlogSlice = backlogIds.slice(0, backlogSlotsLeft)
      backlogSlotsLeft -= backlogSlice.length
      const serveIds = Array.from(new Set([...backlogSlice, ...newlyParked]))
      if (serveIds.length > 0) {
        const exercises = await getStrengthenExercises({
          userId,
          targetLanguage,
          pool,
          sessionHardUserLookupIds: [],
          restrictToUserLookupIds: serveIds,
          parkedOrigin: gateParkedOrigin,
          deps,
        })
        items.push(...exercises.map((entry) => ({ type: 'exercise' as const, entry })))
      }
    }
  }

  // Opt-in-new pass: never-reviewed pronunciation/form facets, served as
  // flashcards. maxNewTerms is pinned to 0 — the citation-new bucket must stay
  // empty (those terms enter via warm-up gates); only the non-citation opt-in
  // bucket may contribute.
  if (wantFlashcards && filter.includeOptInNew && filter.scope !== 'due_only') {
    for (const pool of pools) {
      const optInNew = await deps.userLookupsRepository.listReviewTerms({
        userId,
        targetLanguage,
        pool,
        scope: 'learn_new',
        maxReviewTerms: 0,
        maxLearningTerms: 0,
        maxNewTerms: 0,
        maxOptInNewTerms: HARD_MAX_PRACTICE_NEW_TERMS,
      })
      items.push(...optInNew.map((card) => ({ type: 'flashcard' as const, card })))
    }
  }

  return { items, dailyLimitReached }
}
