import type { StudyFacetsRepositoryInterface } from '../../transport/database/study-facets/study-facets-repository'

export type ParkingPassDependencies = {
  studyFacetsRepository: StudyFacetsRepositoryInterface
}

export type RecognitionParkingResult = {
  scaffolded: string[]
  dailyLimitReached: boolean
}

// The warm-up PARKING mechanism, shared by the session-scoped warm-up
// (startWarmupSession) and the composed queue's auto-warm-up. Candidates must
// already be filtered to eligible-to-enter terms (facet exists, enabled,
// never-reviewed, not parked) — the atomic park method re-checks eligibility
// anyway, so a race merely yields a skipped 'not_eligible'.
//
// Recognition is daily-new-capped: the first genuine 'cap_reached' stops the
// pass and reports dailyLimitReached. 'not_eligible' (e.g. a concurrent tab
// already parked the term) is skipped, NOT a cap hit, so repeat/concurrent
// runs never show a bogus daily message. `maxCount` bounds how many terms this
// pass may park (the composer's coupled budget); `bypassCap` is the explicit
// learn-extra path — it skips only the cap comparison, introductions still
// stamp introduced_at and count toward today.
export const runRecognitionParkingPass = async (params: {
  userId: string
  targetLanguage: string
  candidateUserLookupIds: string[]
  maxNewTerms: number
  maxCount?: number
  bypassCap?: boolean
  deps: ParkingPassDependencies
}): Promise<RecognitionParkingResult> => {
  const scaffolded: string[] = []
  let dailyLimitReached = false
  for (const userLookupId of params.candidateUserLookupIds) {
    if (params.maxCount != null && scaffolded.length >= params.maxCount) break
    const outcome = await params.deps.studyFacetsRepository.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId,
      userId: params.userId,
      targetLanguage: params.targetLanguage,
      maxNewTerms: params.maxNewTerms,
      bypassCap: params.bypassCap,
    })
    if (outcome === 'scaffolded') {
      scaffolded.push(userLookupId)
    } else if (outcome === 'cap_reached') {
      dailyLimitReached = true
      break
    }
  }
  return { scaffolded, dailyLimitReached }
}

// Production counterpart: uncapped by the daily-new budget (production is
// never daily-new-capped), bounded only by the optional `maxCount`. Never
// inherits a recognition cap stop — the two passes are independent.
export const runProductionParkingPass = async (params: {
  userId: string
  targetLanguage: string
  candidateUserLookupIds: string[]
  maxCount?: number
  deps: ParkingPassDependencies
}): Promise<{ scaffolded: string[] }> => {
  const scaffolded: string[] = []
  for (const userLookupId of params.candidateUserLookupIds) {
    if (params.maxCount != null && scaffolded.length >= params.maxCount) break
    const outcome = await params.deps.studyFacetsRepository.initializeAndParkProductionCitationFacet({
      userLookupId,
      userId: params.userId,
      targetLanguage: params.targetLanguage,
    })
    if (outcome === 'scaffolded') scaffolded.push(userLookupId)
  }
  return { scaffolded }
}
