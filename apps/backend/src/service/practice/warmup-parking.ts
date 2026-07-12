import type { StudyFacetsRepositoryInterface } from '../../transport/database/study-facets/study-facets-repository'
import type { PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'

export type ParkingPassDependencies = {
  studyFacetsRepository: StudyFacetsRepositoryInterface
}

export type ParkingPassResult = {
  scaffolded: string[]
  dailyLimitReached: boolean
}

// The warm-up PARKING mechanism, shared by the session-scoped warm-up
// (startWarmupSession) and the composed queue's auto-warm-up, one pass per
// pool — both pools' citation facets consume the SAME combined daily budget.
// Candidates must already be filtered to eligible-to-enter terms (facet
// exists, enabled, never-reviewed, not parked) — the atomic park method
// re-checks eligibility anyway, so a race merely yields a skipped
// 'not_eligible'.
//
// The first genuine 'cap_reached' stops the pass and reports
// dailyLimitReached. 'not_eligible' (e.g. a concurrent tab already parked the
// term) is skipped, NOT a cap hit, so repeat/concurrent runs never show a
// bogus daily message. `maxCount` bounds how many terms this pass may park
// (the composer's per-session budget); `bypassCap` is the explicit learn-extra
// path — it skips only the cap comparison, introductions still stamp
// introduced_at and count toward today.
export const runParkingPass = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
  candidateUserLookupIds: string[]
  maxNewTerms: number
  maxCount?: number
  bypassCap?: boolean
  deps: ParkingPassDependencies
}): Promise<ParkingPassResult> => {
  const skill = params.pool === 'production' ? ('meaning_production' as const) : ('meaning_recognition' as const)
  const scaffolded: string[] = []
  let dailyLimitReached = false
  for (const userLookupId of params.candidateUserLookupIds) {
    if (params.maxCount != null && scaffolded.length >= params.maxCount) break
    const outcome = await params.deps.studyFacetsRepository.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId,
      userId: params.userId,
      targetLanguage: params.targetLanguage,
      skill,
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
