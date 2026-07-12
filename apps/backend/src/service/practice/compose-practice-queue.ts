import type { DbUserLookupWithFacet, PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { HARD_MAX_PRACTICE_NEW_TERMS } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { StrengthenExerciseEntry, ExerciseBankDependencies } from './exercise-bank'
import { getStrengthenExercises, warmHintExerciseBanksForFlashcards } from './exercise-bank'
import { planPracticeQueue } from './plan-practice-queue'
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
  // isNewIntroduction marks a gate whose term THIS compose introduced (the
  // parking pass just stamped it) — the client's "New" bucket, vs "Warm-up"
  // for a backlog gate parked by an earlier compose.
  | { type: 'exercise'; entry: StrengthenExerciseEntry; isNewIntroduction: boolean }

export type ComposePracticeQueueResult = {
  items: ComposedQueueItem[]
  dailyLimitReached: boolean
  canLearnExtra: boolean
}

// One composed practice queue: gate exercises for parked terms (warm-up +
// rehab) interleaved with due flashcards, production first (the plan encodes
// the ordering rationale). Selection and budget arithmetic live in
// planPracticeQueue — shared verbatim with the preview endpoint — and this
// function EXECUTES the plan: composing is a MUTATION when autoWarmup is on,
// parking eligible new terms (stamping introduced_at, consuming the daily-new
// budget) before serving. The coupled budget guarantees a compose never parks
// more terms than it can serve in the same session, so opening Practice and
// leaving never burns budget on terms the user was never shown.
export const composePracticeQueue = async (params: {
  userId: string
  targetLanguage: string
  filter: ComposeQueueFilter
  // Fire-and-forget hint-exercise generation for served flashcard terms whose
  // bank has no hint-type slot. True only for the compose mutation — the
  // serve-only refresh is polled and must never kick LLM work.
  warmHintBanks?: boolean
  deps: ComposePracticeQueueDependencies
}): Promise<ComposePracticeQueueResult> => {
  const { userId, targetLanguage, filter, deps } = params
  const plan = await planPracticeQueue({ userId, targetLanguage, filter, deps })
  const wantFlashcards = filter.render !== 'exercises_only'
  const wantExercises = filter.render !== 'flashcards_only'
  const gateParkedOrigin = filter.scope === 'new_only' ? ('onboarding' as const) : undefined
  const runParking = filter.autoWarmup && wantExercises && filter.scope !== 'due_only'

  // Parking pass (auto-warm-up), executing the plan's sequential allocation:
  // production parks first, recognition eats what's left under its daily cap.
  // The passes run over the FULL candidate lists (not the planned slice) so a
  // concurrent tab's 'not_eligible' races backfill from later candidates.
  let transactionalCapReached = false
  const newlyParkedByPool = new Map<PracticePool, string[]>()
  if (runParking) {
    let parkBudget = plan.parkBudget
    const productionPlan = plan.perPool.find((p) => p.pool === 'production')
    if (productionPlan && parkBudget > 0) {
      const pass = await runProductionParkingPass({
        userId,
        targetLanguage,
        candidateUserLookupIds: productionPlan.introCandidateIds,
        maxCount: parkBudget,
        deps,
      })
      newlyParkedByPool.set('production', pass.scaffolded)
      parkBudget -= pass.scaffolded.length
    }
    const recognitionPlan = plan.perPool.find((p) => p.pool === 'recognition')
    if (recognitionPlan) {
      // The FULL clamped per-language daily-new cap — the atomic park method
      // does its own today-count comparison against it.
      const maxNewTerms = plan.dailyBudget.max
      if (parkBudget > 0) {
        const pass = await runRecognitionParkingPass({
          userId,
          targetLanguage,
          candidateUserLookupIds: recognitionPlan.introCandidateIds,
          maxNewTerms,
          maxCount: parkBudget,
          deps,
        })
        newlyParkedByPool.set('recognition', pass.scaffolded)
        transactionalCapReached = pass.dailyLimitReached
      }
      // Learn extra: the user explicitly asked for N more, so this pass
      // ignores both the daily cap (bypassCap) and the coupled budget — the
      // extra gates are always served, even past MAX_GATES_PER_COMPOSE.
      if (filter.learnExtraCount != null && filter.learnExtraCount > 0) {
        const alreadyParked = new Set(newlyParkedByPool.get('recognition') ?? [])
        const extra = await runRecognitionParkingPass({
          userId,
          targetLanguage,
          candidateUserLookupIds: recognitionPlan.introCandidateIds.filter((id) => !alreadyParked.has(id)),
          maxNewTerms: plan.dailyBudget.max,
          maxCount: filter.learnExtraCount,
          bypassCap: true,
          deps,
        })
        newlyParkedByPool.set('recognition', [...(newlyParkedByPool.get('recognition') ?? []), ...extra.scaffolded])
      }
    }
  }

  const items: ComposedQueueItem[] = []
  for (const poolPlan of plan.perPool) {
    if (wantFlashcards && filter.scope !== 'new_only') {
      // 'review_due' is load-bearing (enforced by the plan's dueRows fetch):
      // citation-new terms must NEVER enter the composed queue as flashcards
      // (they enter via warm-up gates). The opt-in-new pass below is the one
      // deliberate exception.
      items.push(...poolPlan.dueRows.map((card) => ({ type: 'flashcard' as const, card })))
    }
    if (wantExercises) {
      const newlyParked = newlyParkedByPool.get(poolPlan.pool) ?? []
      const newlyParkedSet = new Set(newlyParked)
      // The plan's head-slice keeps the longest-waiting gates; newly-parked
      // terms are served on top (their slots were reserved by the coupled
      // budget; learn-extra may exceed the cap — an explicit user request).
      const serveIds = Array.from(new Set([...poolPlan.backlogServedIds, ...newlyParked]))
      if (serveIds.length > 0) {
        const exercises = await getStrengthenExercises({
          userId,
          targetLanguage,
          pool: poolPlan.pool,
          sessionHardUserLookupIds: [],
          restrictToUserLookupIds: serveIds,
          parkedOrigin: gateParkedOrigin,
          deps,
        })
        items.push(
          ...exercises.map((entry) => ({
            type: 'exercise' as const,
            entry,
            isNewIntroduction: newlyParkedSet.has(entry.userLookupId),
          }))
        )
      }
    }
  }

  // Opt-in-new pass: never-reviewed pronunciation/form facets, served as
  // flashcards. maxNewTerms is pinned to 0 — the citation-new bucket must stay
  // empty (those terms enter via warm-up gates); only the non-citation opt-in
  // bucket may contribute.
  if (wantFlashcards && filter.includeOptInNew && filter.scope !== 'due_only') {
    for (const poolPlan of plan.perPool) {
      const optInNew = await deps.userLookupsRepository.listReviewTerms({
        userId,
        targetLanguage,
        pool: poolPlan.pool,
        scope: 'learn_new',
        maxReviewTerms: 0,
        maxLearningTerms: 0,
        maxNewTerms: 0,
        maxOptInNewTerms: HARD_MAX_PRACTICE_NEW_TERMS,
      })
      items.push(...optInNew.map((card) => ({ type: 'flashcard' as const, card })))
    }
  }

  if (params.warmHintBanks) {
    void warmHintExerciseBanksForFlashcards({
      cards: items.flatMap((item) => (item.type === 'flashcard' ? [item.card] : [])),
      deps,
    }).catch((err) => console.error('hint bank warmer threw', { err }))
  }

  // Predicted OR transactional: the prediction covers the budget-already-
  // exhausted case (the pass never runs at parkBudget 0), the transactional
  // outcome covers races the prediction can't see.
  return {
    items,
    dailyLimitReached: plan.dailyLimitReached || transactionalCapReached,
    canLearnExtra: plan.canLearnExtra,
  }
}
