import type { DbUserLookupWithFacet, PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { BookPinsRepositoryInterface } from '../../transport/database/book-pins/book-pins-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import type { StrengthenExerciseEntry, ExerciseBankDependencies } from './exercise-bank'
import { getIntroductionExercises, getStrengthenExercises, warmHintExerciseBanksForFlashcards } from './exercise-bank'
import { planPracticeQueue } from './plan-practice-queue'
import type { WarmedWord } from '../word-family/word-family'

export type ComposePracticeQueueDependencies = ExerciseBankDependencies & {
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
  bookPinsRepository: BookPinsRepositoryInterface
  // Bound warmWordFamilyInsights (service/word-family), injected so the
  // composer doesn't carry the word-family repositories.
  warmWordFamilyInsights: (params: { userId: string; targetLanguage: string; words: WarmedWord[] }) => Promise<void>
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
  // facet identity), so this pass is their ONLY introduction path. The
  // everyday queue paces them (MAX_OPT_IN_NEW_PER_SESSION) so an enabled
  // backlog can't flood a session; the Learn-new preset takes more.
  includeOptInNew: boolean
  // Explicit "learn extra" request: plan up to this many more recognition
  // terms past the daily-new cap. They still stamp introduced_at when reached.
  learnExtraCount?: number
}

// The card's grammar.pos, as the flashcard sends it to glosses.wordFamily.
const grammarPos = (grammar: unknown): string | null => {
  const pos = (grammar as Record<string, unknown> | null)?.pos
  return typeof pos === 'string' ? pos : null
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
  // Fire-and-forget LLM work for the served flashcards: hint exercises for
  // terms whose bank has no hint-type slot, and word-family insights for
  // their backs. True only for the initial compose request — the polled
  // refresh must never kick LLM work.
  warmFlashcardCaches?: boolean
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
      // dueRows holds due cards only: citation-new terms must NEVER enter the
      // composed queue as flashcards (they enter via warm-up gates). The opt-in-new pass below is the one
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
  // flashcards after everything else. Citation-new terms never come through
  // here — they enter via warm-up gates.
  for (const poolPlan of plan.perPool) {
    items.push(...poolPlan.optInNewRows.map((card) => ({ type: 'flashcard' as const, card })))
  }

  if (params.warmFlashcardCaches) {
    const flashcards = items.flatMap((item) => (item.type === 'flashcard' ? [item.card] : []))
    void warmHintExerciseBanksForFlashcards({ cards: flashcards, deps }).catch((err) =>
      console.error('hint bank warmer threw', { err })
    )
    // Pronunciation cards don't show the word-family line.
    const words = flashcards
      .filter((card) => card.skill !== 'pronunciation')
      .map((card) => ({ headword: card.headword, pos: grammarPos(card.grammar) }))
    void deps
      .warmWordFamilyInsights({ userId, targetLanguage, words })
      .catch((err) => console.error('word-family insight warmer threw', { err }))
  }

  return {
    items,
    dailyLimitReached: plan.dailyLimitReached,
    canLearnExtra: plan.canLearnExtra,
  }
}
