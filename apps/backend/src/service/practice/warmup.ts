import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { StrengthenExerciseEntry, ExerciseBankDependencies } from './exercise-bank'
import { getStrengthenExercises } from './exercise-bank'
import { clampPracticeSessionLimits } from './review-caps'

export type WarmupDependencies = ExerciseBankDependencies & {
  studySessionsRepository: StudySessionsRepositoryInterface
}

export type StartWarmupResult =
  | { ok: true; exercises: StrengthenExerciseEntry[]; dailyLimitReached: boolean }
  | { ok: false; reason: 'not_found' | 'language_mismatch' }

// Exercise-first warm-up: park this session's not-yet-introduced kept terms
// into scaffolding (the same parked + rehab machinery leeches use, entered from
// the opposite direction) and serve them gate exercises. Correct answers drive
// the existing rehab counter; after the graduation threshold each term
// soft-re-enters the FSRS flashcard queue. Warm-up is the recognition pool only
// (the citation meaning_recognition facet is the one daily-new-capped card).
export const startWarmupSession = async (params: {
  userId: string
  studySessionId: string
  targetLanguage: string
  deps: WarmupDependencies
}): Promise<StartWarmupResult> => {
  const { userId, studySessionId, targetLanguage, deps } = params

  const session = await deps.studySessionsRepository.findByIdForUser(studySessionId, userId)
  if (!session) return { ok: false, reason: 'not_found' }
  if (session.target_language !== targetLanguage) return { ok: false, reason: 'language_mismatch' }

  // The FULL clamped per-language daily-new cap. The atomic init+park method
  // does its own today-count comparison against it (so subtracting here would
  // double-count), mirroring initializeCitationFacetIfUnderDailyCap.
  const maxNewTerms = clampPracticeSessionLimits(
    await deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(userId, targetLanguage)
  ).maxNewTerms

  const facetStates = await deps.studyFacetsRepository.listSessionKeptCitationFacets(studySessionId)

  // Terms already onboarding-parked from a prior visit (parked + never-reviewed)
  // must still be served on a re-enter — eligibility-to-ENTER skips them, so
  // serving can't be scoped only to terms parked in this call.
  const alreadyOnboardingIds = facetStates
    .filter((f) => f.hasFacet && f.leechParkedAt != null && f.srsState == null)
    .map((f) => f.userLookupId)

  // A term can ENTER scaffolding iff its recognition facet exists, is enabled,
  // is never-reviewed, and is not already parked.
  const eligibleToEnter = facetStates.filter(
    (f) => f.hasFacet && f.disabledAt == null && f.srsState == null && f.leechParkedAt == null
  )

  const newlyScaffoldedIds: string[] = []
  let dailyLimitReached = false
  for (const term of eligibleToEnter) {
    const outcome = await deps.studyFacetsRepository.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId: term.userLookupId,
      userId,
      targetLanguage,
      maxNewTerms,
    })
    if (outcome === 'scaffolded') {
      newlyScaffoldedIds.push(term.userLookupId)
    } else if (outcome === 'cap_reached') {
      // A genuine over-cap term: stop entering more and report the daily limit.
      // 'not_eligible' (e.g. a concurrent tab already parked it) is skipped, NOT
      // a cap hit, so repeat/concurrent starts never show a bogus daily message.
      dailyLimitReached = true
      break
    }
  }

  const restrictToUserLookupIds = Array.from(new Set([...alreadyOnboardingIds, ...newlyScaffoldedIds]))

  const exercises = await getStrengthenExercises({
    userId,
    targetLanguage,
    pool: 'recognition',
    sessionHardUserLookupIds: [],
    restrictToUserLookupIds,
    parkedOrigin: 'onboarding',
    deps,
  })

  return { ok: true, exercises, dailyLimitReached }
}

export type RefreshWarmupResult =
  | { ok: true; exercises: StrengthenExerciseEntry[] }
  | { ok: false; reason: 'not_found' | 'language_mismatch' }

// Serve-only re-fetch of a warm-up session's exercises — NO parking, NO
// introductions (so it is safe to poll while placeholders generate). Re-serves
// every term in this session that is currently onboarding-parked (parked +
// never-reviewed), upgrading 'generating' placeholders to 'ready'/'failed' as
// the background bank settles.
export const refreshWarmupSession = async (params: {
  userId: string
  studySessionId: string
  targetLanguage: string
  deps: WarmupDependencies
}): Promise<RefreshWarmupResult> => {
  const { userId, studySessionId, targetLanguage, deps } = params

  const session = await deps.studySessionsRepository.findByIdForUser(studySessionId, userId)
  if (!session) return { ok: false, reason: 'not_found' }
  if (session.target_language !== targetLanguage) return { ok: false, reason: 'language_mismatch' }

  const facetStates = await deps.studyFacetsRepository.listSessionKeptCitationFacets(studySessionId)
  const restrictToUserLookupIds = facetStates
    .filter((f) => f.hasFacet && f.leechParkedAt != null && f.srsState == null)
    .map((f) => f.userLookupId)

  const exercises = await getStrengthenExercises({
    userId,
    targetLanguage,
    pool: 'recognition',
    sessionHardUserLookupIds: [],
    restrictToUserLookupIds,
    parkedOrigin: 'onboarding',
    deps,
  })

  return { ok: true, exercises }
}

// Language-scoped, serve-only continuation of warm-up: serves EVERY
// onboarding-parked term for the language (not scoped to a session), so a user
// who abandoned a warm-up can resume it from the Practice tab. No parking, no
// introductions — safe to poll. Powers the "N terms warming up — continue"
// affordance. Leeches are excluded (they have the Strengthen surface).
export const continueWarmupSession = async (params: {
  userId: string
  targetLanguage: string
  deps: WarmupDependencies
}): Promise<{ exercises: StrengthenExerciseEntry[] }> => {
  const { userId, targetLanguage, deps } = params
  const exercises = await getStrengthenExercises({
    userId,
    targetLanguage,
    pool: 'recognition',
    sessionHardUserLookupIds: [],
    parkedOrigin: 'onboarding',
    deps,
  })
  return { exercises }
}
