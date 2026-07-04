import type { ExerciseType } from '../../transport/database/practice-exercises/practice-exercises-repository'
import type { DbUserLookupWithFacet, PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import {
  CITATION_FORM,
  skillForPool,
  type StudyFacetsRepositoryInterface,
} from '../../transport/database/study-facets/study-facets-repository'
import { softReentryResult } from './fsrs'
import { LEECH_GRADUATION_DAYS, isParked } from './leech-config'

export type RehabDependencies = {
  studyFacetsRepository: StudyFacetsRepositoryInterface
}

// Escalating gate-exercise ladder, derived from the term's rehab day count
// (tier = rehab_correct_days, no extra column). Pool-matched: recognition
// stays in MC exercises, production escalates to typed production. Day 3
// repeats the hardest reached tier on a FRESH exercise (every answered attempt
// consumes its exercise, so "fresh" is structural).
const RECOGNITION_LADDER: ExerciseType[] = ['mc_cloze', 'mc_comprehension', 'mc_cloze']
const PRODUCTION_LADDER: ExerciseType[] = ['mc_cloze', 'production_cloze', 'production_cloze']

export const gateTypeForTier = (pool: PracticePool, rehabCorrectDays: number): ExerciseType => {
  const ladder = pool === 'recognition' ? RECOGNITION_LADDER : PRODUCTION_LADDER
  const tier = Math.max(0, Math.min(rehabCorrectDays, ladder.length - 1))
  return ladder[tier]!
}

export const rehabCorrectDaysFor = (lookup: DbUserLookupWithFacet): number => lookup.leech_rehab_correct_days

export type GateAnswerOutcome = {
  // Day count after this answer (unchanged when the answer was wrong or the
  // day was already credited). Null when the term wasn't parked in this pool.
  rehabCorrectDays: number | null
  graduated: boolean
}

// Apply a gate-exercise answer to a parked term's rehab state. Called from
// submitExerciseAnswer AFTER the exercise has been consumed:
//   correct  -> advanceRehabDay (the IS DISTINCT FROM CURRENT_DATE guard makes
//               massed same-day corrects count once) -> graduate at the
//               threshold via one-shot soft re-entry.
//   incorrect -> no advance; the consumed exercise is the only cost. A later
//               same-day correct attempt (on a fresh exercise) can still earn
//               that day's credit.
export const applyGateAnswer = async (params: {
  lookup: DbUserLookupWithFacet
  pool: PracticePool
  correct: boolean
  deps: RehabDependencies
}): Promise<GateAnswerOutcome> => {
  const { lookup, pool, correct, deps } = params
  if (!isParked(lookup)) return { rehabCorrectDays: null, graduated: false }

  const skill = skillForPool(pool)
  const daysBefore = rehabCorrectDaysFor(lookup)
  if (!correct) return { rehabCorrectDays: daysBefore, graduated: false }

  const advanced = await deps.studyFacetsRepository.advanceRehabDayFacet({
    userLookupId: lookup.id,
    skill,
    targetForm: CITATION_FORM,
  })
  const days = advanced ?? daysBefore
  if (days < LEECH_GRADUATION_DAYS) return { rehabCorrectDays: days, graduated: false }

  const reentry = softReentryResult(new Date())
  await deps.studyFacetsRepository.unparkAndSoftReentryFacet({
    userLookupId: lookup.id,
    skill,
    targetForm: CITATION_FORM,
    state: reentry.state,
    due: reentry.due,
    stability: reentry.stability,
    difficulty: reentry.difficulty,
    lastReview: reentry.lastReview,
  })
  return { rehabCorrectDays: days, graduated: true }
}

// User-chosen exit ramp for a parked term whose gate-exercise bank is
// terminally exhausted: study it as a normal flashcard instead. Same soft
// re-entry write as graduation, except due NOW — the user explicitly asked to
// practice this term, so it must be servable by the very next compose rather
// than tomorrow. Returns false when the pool's citation facet is missing or
// not parked (idempotent; racing a concurrent graduation is not an error).
export const unparkTermToFlashcard = async (params: {
  userLookupId: string
  pool: PracticePool
  deps: RehabDependencies
}): Promise<boolean> => {
  const { userLookupId, pool, deps } = params
  const skill = skillForPool(pool)
  const facet = await deps.studyFacetsRepository.getFacet({
    userLookupId,
    skill,
    targetForm: CITATION_FORM,
  })
  if (!facet || facet.leech_parked_at == null) return false

  const reentry = softReentryResult(new Date())
  await deps.studyFacetsRepository.unparkAndSoftReentryFacet({
    userLookupId,
    skill,
    targetForm: CITATION_FORM,
    state: reentry.state,
    due: reentry.lastReview,
    stability: reentry.stability,
    difficulty: reentry.difficulty,
    lastReview: reentry.lastReview,
  })
  return true
}
