import type { DbUserLookupWithFacet, PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { HARD_MAX_PRACTICE_NEW_TERMS } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { StrengthenExerciseEntry, ExerciseBankDependencies } from './exercise-bank'
import { getIntroductionExercises, getStrengthenExercises, warmHintExerciseBanksForFlashcards } from './exercise-bank'
import { planPracticeQueue } from './plan-practice-queue'

export type ComposePracticeQueueDependencies = ExerciseBankDependencies & {
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
}

// Which terms are in scope, and how they render. Planned citation introductions
// and parked terms are gates; due/graduated terms and new opt-in facets are
// flashcards. The filter only selects which populations participate.
export type ComposeQueueFilter = {
  pools: PracticePool[]
  // 'due_only' skips planned introductions and the opt-in-new pass entirely;
  // 'new_only' skips due flashcards and restricts gates to onboarding-parked
  // terms (warm-up gates — a leech's rehab is due work, not new work).
  scope: 'due_only' | 'new_only' | 'both'
  render: 'flashcards_only' | 'exercises_only' | 'both'
  // Plan eligible new terms as onboarding gates (the "no new citation
  // flashcards" on-ramp). Each gate is parked only when reached.
  autoWarmup: boolean
  // Serve never-reviewed opt-in (non-citation) facets — pronunciation and
  // form cards — as flashcards. They never park (the exercise bank has no
  // facet identity), so this pass is their ONLY introduction path; it is
  // reserved for the explicit Learn-new preset, mirroring the old rule that
  // opt-in new facets are served only in learn_new scope, never mixed.
  includeOptInNew: boolean
  // Explicit "learn extra" request: plan up to this many more recognition
  // terms past the daily-new cap. They still stamp introduced_at when reached.
  learnExtraCount?: number
}

export type ComposedQueueItem =
  | { type: 'flashcard'; card: DbUserLookupWithFacet }
  // New introductions are planned without mutating SRS state. bypassDailyCap
  // is true only for an explicit Learn-extra batch and is consumed by the
  // claim endpoint when this item is reached.
  | {
      type: 'exercise'
      entry: StrengthenExerciseEntry
      isNewIntroduction: boolean
      bypassDailyCap: boolean
    }

export type ComposePracticeQueueResult = {
  items: ComposedQueueItem[]
  dailyLimitReached: boolean
  canLearnExtra: boolean
}

// One composed practice queue: gate exercises for parked terms (warm-up +
// rehab) interleaved with due flashcards, production first (the plan encodes
// the ordering rationale). Selection and budget arithmetic live in
// planPracticeQueue — shared verbatim with the preview endpoint — and this
// function materializes the plan without changing SRS state. Planned new gates
// are claimed individually when the client reaches them, so opening and
// leaving a session cannot consume the daily introduction budget.
export const composePracticeQueue = async (params: {
  userId: string
  targetLanguage: string
  filter: ComposeQueueFilter
  // Fire-and-forget hint-exercise generation for served flashcard terms whose
  // bank has no hint-type slot. True only for the initial compose request —
  // the polled refresh must never kick LLM work.
  warmHintBanks?: boolean
  deps: ComposePracticeQueueDependencies
}): Promise<ComposePracticeQueueResult> => {
  const { userId, targetLanguage, filter, deps } = params
  const plan = await planPracticeQueue({ userId, targetLanguage, filter, deps })
  const wantFlashcards = filter.render !== 'exercises_only'
  const wantExercises = filter.render !== 'flashcards_only'
  const gateParkedOrigin = filter.scope === 'new_only' ? ('onboarding' as const) : undefined

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
      if (poolPlan.backlogServedIds.length > 0) {
        const exercises = await getStrengthenExercises({
          userId,
          targetLanguage,
          pool: poolPlan.pool,
          sessionHardUserLookupIds: [],
          restrictToUserLookupIds: poolPlan.backlogServedIds,
          parkedOrigin: gateParkedOrigin,
          deps,
        })
        items.push(
          ...exercises.map((entry) => ({
            type: 'exercise' as const,
            entry,
            isNewIntroduction: false,
            bypassDailyCap: false,
          }))
        )
      }
      const standardIds = poolPlan.introCandidateIds.slice(0, poolPlan.plannedIntroductionCount)
      const extraIds = poolPlan.plannedExtraIntroductionIds
      const plannedIds = [...standardIds, ...extraIds]
      if (plannedIds.length > 0) {
        const exercises = await getIntroductionExercises({
          userId,
          targetLanguage,
          pool: poolPlan.pool,
          userLookupIds: plannedIds,
          deps,
        })
        const extraSet = new Set(extraIds)
        items.push(
          ...exercises.map((entry) => ({
            type: 'exercise' as const,
            entry,
            isNewIntroduction: true,
            bypassDailyCap: extraSet.has(entry.userLookupId),
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

  return {
    items,
    dailyLimitReached: plan.dailyLimitReached,
    canLearnExtra: plan.canLearnExtra,
  }
}
