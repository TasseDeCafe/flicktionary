import type { ExerciseType } from '../../transport/database/practice-exercises/practice-exercises-repository'
import type {
  DbUserLookup,
  PracticePool,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import { softReentryResult } from './fsrs'
import { LEECH_GRADUATION_DAYS, isParked } from './leech-config'

export type RehabDependencies = {
  userLookupsRepository: UserLookupsRepositoryInterface
}

// Escalating gate-exercise ladder, derived from the term's rehab day count
// (tier = rehab_correct_days, no extra column). Pool-matched: passive stays
// in recognition, active escalates to typed production. Day 3 repeats the
// hardest reached tier on a FRESH exercise (every answered attempt consumes
// its exercise, so "fresh" is structural).
const PASSIVE_LADDER: ExerciseType[] = ['mc_cloze', 'mc_comprehension', 'mc_cloze']
const ACTIVE_LADDER: ExerciseType[] = ['mc_cloze', 'production_cloze', 'production_cloze']

export const gateTypeForTier = (pool: PracticePool, rehabCorrectDays: number): ExerciseType => {
  const ladder = pool === 'passive' ? PASSIVE_LADDER : ACTIVE_LADDER
  const tier = Math.max(0, Math.min(rehabCorrectDays, ladder.length - 1))
  return ladder[tier]!
}

export const rehabCorrectDaysFor = (lookup: DbUserLookup, pool: PracticePool): number =>
  pool === 'passive' ? lookup.leech_rehab_correct_days : lookup.active_leech_rehab_correct_days

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
  lookup: DbUserLookup
  pool: PracticePool
  correct: boolean
  deps: RehabDependencies
}): Promise<GateAnswerOutcome> => {
  const { lookup, pool, correct, deps } = params
  if (!isParked(lookup, pool)) return { rehabCorrectDays: null, graduated: false }

  const daysBefore = rehabCorrectDaysFor(lookup, pool)
  if (!correct) return { rehabCorrectDays: daysBefore, graduated: false }

  const advanced = await deps.userLookupsRepository.advanceRehabDay({ userLookupId: lookup.id, pool })
  const days = advanced ?? daysBefore
  if (days < LEECH_GRADUATION_DAYS) return { rehabCorrectDays: days, graduated: false }

  const reentry = softReentryResult(new Date())
  await deps.userLookupsRepository.unparkAndSoftReentry({
    userLookupId: lookup.id,
    pool,
    state: reentry.state,
    due: reentry.due,
    stability: reentry.stability,
    difficulty: reentry.difficulty,
    lastReview: reentry.lastReview,
  })
  return { rehabCorrectDays: days, graduated: true }
}
