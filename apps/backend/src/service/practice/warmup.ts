import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { SessionKeptCitationFacet } from '../../transport/database/study-facets/study-facets-repository'
import type { PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { StrengthenExerciseEntry, ExerciseBankDependencies } from './exercise-bank'
import { getStrengthenExercises } from './exercise-bank'
import { clampPracticeSessionLimits } from './review-caps'

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
// Both pools are warmed in two INDEPENDENT passes over the session's kept terms:
//   - recognition: the citation meaning_recognition facet, DAILY-NEW-CAPPED. The
//     first cap_reached stops further recognition entries and reports
//     dailyLimitReached.
//   - production: the citation meaning_production facet, UNCAPPED (production is
//     never daily-new-capped). This pass MUST NOT inherit the recognition cap's
//     stop — a recognition cap hit must not block parking a later term's
//     production facet.
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

  // Recognition pass (daily-new-capped). The FULL clamped per-language daily-new
  // cap — the atomic init+park method does its own today-count comparison
  // against it (so subtracting here would double-count).
  const maxNewTerms = clampPracticeSessionLimits(
    await deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(userId, targetLanguage)
  ).maxNewTerms

  const recognitionFacets = await deps.studyFacetsRepository.listSessionKeptCitationFacets(
    studySessionId,
    'meaning_recognition'
  )
  const recognitionScaffolded: string[] = []
  let dailyLimitReached = false
  for (const term of eligibleToEnter(recognitionFacets)) {
    const outcome = await deps.studyFacetsRepository.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId: term.userLookupId,
      userId,
      targetLanguage,
      maxNewTerms,
    })
    if (outcome === 'scaffolded') {
      recognitionScaffolded.push(term.userLookupId)
    } else if (outcome === 'cap_reached') {
      // A genuine over-cap term: stop entering more RECOGNITION terms and report
      // the daily limit. 'not_eligible' (e.g. a concurrent tab already parked it)
      // is skipped, NOT a cap hit, so repeat/concurrent starts never show a bogus
      // daily message.
      dailyLimitReached = true
      break
    }
  }
  const recognitionIds = Array.from(new Set([...alreadyOnboardingIds(recognitionFacets), ...recognitionScaffolded]))

  // Production pass (uncapped, independent — never stops on the recognition cap).
  const productionFacets = await deps.studyFacetsRepository.listSessionKeptCitationFacets(
    studySessionId,
    'meaning_production'
  )
  const productionScaffolded: string[] = []
  for (const term of eligibleToEnter(productionFacets)) {
    const outcome = await deps.studyFacetsRepository.initializeAndParkProductionCitationFacet({
      userLookupId: term.userLookupId,
      userId,
      targetLanguage,
    })
    if (outcome === 'scaffolded') productionScaffolded.push(term.userLookupId)
  }
  const productionIds = Array.from(new Set([...alreadyOnboardingIds(productionFacets), ...productionScaffolded]))

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

// Language-scoped, serve-only continuation of warm-up: serves EVERY
// onboarding-parked term for the language in the given pool (not scoped to a
// session), so a user who abandoned a warm-up can resume it from the Practice
// tab. No parking, no introductions — safe to poll. Powers the per-pool
// "N terms warming up — continue" affordances. Leeches are excluded (they have
// the Strengthen surface).
export const continueWarmupSession = async (params: {
  userId: string
  targetLanguage: string
  pool?: PracticePool
  deps: WarmupDependencies
}): Promise<{ exercises: StrengthenExerciseEntry[] }> => {
  const { userId, targetLanguage, pool = 'recognition', deps } = params
  const exercises = await serveOnboarding({ userId, targetLanguage, pool, deps })
  return { exercises }
}
