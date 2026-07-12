import type {
  PracticePool,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import {
  CITATION_FORM,
  type StudyFacetsRepositoryInterface,
} from '../../transport/database/study-facets/study-facets-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { clampPracticeSessionLimits } from './review-caps'

export type ClaimPracticeIntroductionDependencies = {
  studyFacetsRepository: StudyFacetsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
}

export type ClaimPracticeIntroductionStatus = 'claimed' | 'already_claimed' | 'daily_cap_reached' | 'unavailable'

// Atomically converts one planned onboarding gate into committed SRS work.
// Composition stays read-only; this runs immediately before the client shows
// the gate, which is the point at which its daily introduction slot is spent.
export const claimPracticeIntroduction = async (params: {
  userId: string
  userLookupId: string
  targetLanguage: string
  pool: PracticePool
  bypassDailyCap: boolean
  deps: ClaimPracticeIntroductionDependencies
}): Promise<ClaimPracticeIntroductionStatus> => {
  const lookup = await params.deps.userLookupsRepository.findByIdForUser(params.userLookupId, params.userId)
  if (!lookup || lookup.deleted_at != null || lookup.count <= 0 || lookup.target_language !== params.targetLanguage) {
    return 'unavailable'
  }
  const limits = clampPracticeSessionLimits(
    await params.deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(
      params.userId,
      params.targetLanguage
    )
  )
  const skill = params.pool === 'production' ? ('meaning_production' as const) : ('meaning_recognition' as const)
  const outcome = await params.deps.studyFacetsRepository.initializeAndParkCitationFacetIfUnderDailyCap({
    userLookupId: params.userLookupId,
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    skill,
    maxNewTerms: limits.maxNewTerms,
    bypassCap: params.bypassDailyCap,
  })
  if (outcome === 'scaffolded') return 'claimed'
  if (outcome === 'cap_reached') return 'daily_cap_reached'

  // A concurrent tab or a resumed session may have claimed the same planned
  // item already. That state is safe to render; every other ineligible state
  // is dropped rather than exposing an exercise that cannot be submitted.
  const facet = await params.deps.studyFacetsRepository.getFacet({
    userLookupId: params.userLookupId,
    skill,
    targetForm: CITATION_FORM,
  })
  return facet?.leech_parked_at != null && facet.disabled_at == null ? 'already_claimed' : 'unavailable'
}
