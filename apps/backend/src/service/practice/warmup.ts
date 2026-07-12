import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { SessionKeptCitationFacet } from '../../transport/database/study-facets/study-facets-repository'
import type { PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { StrengthenExerciseEntry, ExerciseBankDependencies } from './exercise-bank'
import { getStrengthenExercises } from './exercise-bank'
import { clampPracticeSessionLimits } from './review-caps'
import { runParkingPass } from './warmup-parking'

export type WarmupDependencies = ExerciseBankDependencies & {
  studySessionsRepository: StudySessionsRepositoryInterface
}

export type StartWarmupResult =
  | { ok: true; exercises: StrengthenExerciseEntry[]; dailyLimitReached: boolean }
  | { ok: false; reason: 'not_found' | 'language_mismatch' }

// A term can ENTER scaffolding iff its facet for this pool exists, is enabled,
// is never-reviewed, and is not already parked.
const eligibleToEnter = (facets: SessionKeptCitationFacet[]): SessionKeptCitationFacet[] =>
  facets.filter((f) => f.hasFacet && f.disabledAt == null && f.srsState == null && f.leechParkedAt == null)

// Terms already onboarding-parked from a prior visit (parked + never-reviewed)
// must still be served on a re-enter — eligibility-to-ENTER skips them, so
// serving can't be scoped only to terms parked in this call.
const alreadyOnboardingIds = (facets: SessionKeptCitationFacet[]): string[] =>
  facets.filter((f) => f.hasFacet && f.leechParkedAt != null && f.srsState == null).map((f) => f.userLookupId)

const serveOnboarding = (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
  restrictToUserLookupIds?: string[]
  deps: WarmupDependencies
}): Promise<StrengthenExerciseEntry[]> =>
  getStrengthenExercises({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    pool: params.pool,
    sessionHardUserLookupIds: [],
    restrictToUserLookupIds: params.restrictToUserLookupIds,
    parkedOrigin: 'onboarding',
    deps: params.deps,
  })

// Exercise-first warm-up: park this session's not-yet-introduced kept terms into
// scaffolding (the same parked + rehab machinery leeches use, entered from the
// opposite direction) and serve them gate exercises. Correct answers drive the
// existing rehab counter; after the graduation threshold each term soft-re-enters
// the FSRS flashcard queue.
//
// Both pools are warmed in two passes over the session's kept terms — the two
// citation facets consume ONE combined daily budget, and either pass's
// cap_reached reports dailyLimitReached. The passes don't inherit each
// other's stop (each guard refuses over-budget entries itself).
// The served queue is mixed (recognition exercises ++ production exercises); each
// exercise carries its own pool so answering routes to the right facet.
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

  // Both pools' citation facets consume ONE combined daily budget. The FULL
  // clamped per-language cap — the atomic init+park method does its own
  // today-count comparison against it (so subtracting here would
  // double-count). A cap hit in one pass doesn't stop the other (a later
  // term's facet in the other pool would be refused by its own guard anyway).
  const maxNewTerms = clampPracticeSessionLimits(
    await deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(userId, targetLanguage)
  ).maxNewTerms

  const recognitionFacets = await deps.studyFacetsRepository.listSessionKeptCitationFacets(
    studySessionId,
    'meaning_recognition'
  )
  const recognitionPass = await runParkingPass({
    userId,
    targetLanguage,
    pool: 'recognition',
    candidateUserLookupIds: eligibleToEnter(recognitionFacets).map((f) => f.userLookupId),
    maxNewTerms,
    deps,
  })
  const recognitionIds = Array.from(
    new Set([...alreadyOnboardingIds(recognitionFacets), ...recognitionPass.scaffolded])
  )

  const productionFacets = await deps.studyFacetsRepository.listSessionKeptCitationFacets(
    studySessionId,
    'meaning_production'
  )
  const productionPass = await runParkingPass({
    userId,
    targetLanguage,
    pool: 'production',
    candidateUserLookupIds: eligibleToEnter(productionFacets).map((f) => f.userLookupId),
    maxNewTerms,
    deps,
  })
  const productionIds = Array.from(new Set([...alreadyOnboardingIds(productionFacets), ...productionPass.scaffolded]))
  const dailyLimitReached = recognitionPass.dailyLimitReached || productionPass.dailyLimitReached

  const [recognitionExercises, productionExercises] = await Promise.all([
    serveOnboarding({ userId, targetLanguage, pool: 'recognition', restrictToUserLookupIds: recognitionIds, deps }),
    serveOnboarding({ userId, targetLanguage, pool: 'production', restrictToUserLookupIds: productionIds, deps }),
  ])

  return { ok: true, exercises: [...recognitionExercises, ...productionExercises], dailyLimitReached }
}

export type RefreshWarmupResult =
  | { ok: true; exercises: StrengthenExerciseEntry[] }
  | { ok: false; reason: 'not_found' | 'language_mismatch' }

// Serve-only re-fetch of a warm-up session's exercises — NO parking, NO
// introductions (so it is safe to poll while placeholders generate). Re-serves
// every term in this session that is currently onboarding-parked (parked +
// never-reviewed) in BOTH pools, upgrading 'generating' placeholders to
// 'ready'/'failed' as the background bank settles.
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

  const [recognitionFacets, productionFacets] = await Promise.all([
    deps.studyFacetsRepository.listSessionKeptCitationFacets(studySessionId, 'meaning_recognition'),
    deps.studyFacetsRepository.listSessionKeptCitationFacets(studySessionId, 'meaning_production'),
  ])

  const [recognitionExercises, productionExercises] = await Promise.all([
    serveOnboarding({
      userId,
      targetLanguage,
      pool: 'recognition',
      restrictToUserLookupIds: alreadyOnboardingIds(recognitionFacets),
      deps,
    }),
    serveOnboarding({
      userId,
      targetLanguage,
      pool: 'production',
      restrictToUserLookupIds: alreadyOnboardingIds(productionFacets),
      deps,
    }),
  ])

  return { ok: true, exercises: [...recognitionExercises, ...productionExercises] }
}
