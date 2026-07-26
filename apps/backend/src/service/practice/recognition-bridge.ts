import {
  CITATION_FORM,
  type StudyFacetsRepositoryInterface,
} from '../../transport/database/study-facets/study-facets-repository'
import { mergeFacet, type DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import { applyRating, knownAssertResult } from './fsrs'
import type { WithTransaction } from './rate-term'

export type RecognitionBridgeDependencies = {
  studyFacetsRepository: StudyFacetsRepositoryInterface
  withTransaction: WithTransaction
}

// Production evidence waters the recognition schedule: a correct answer on the
// citation production facet proves the strictly harder skill, so the citation
// RECOGNITION sibling is credited without the user ever drilling it directly.
// Paired with the intro-side exclusion (noLiveProductionSiblingSql /
// the park guard's not_eligible), this is why a term with production work in
// flight never enters recognition warm-up or the recognition new bucket — its
// recognition schedule arrives here instead.
//
// Two shapes, both DIRECT facet writes with NO practice_rating_events row —
// the same convention as warm-up graduation (unparkAndSoftReentryFacet):
// derived credit must not charge the recognition review budget, count as
// practice activity, or enter the undo chain (undoing the production rating
// leaves the bridged credit in place; the next production rating simply
// re-derives it).
//   - never-scheduled facet → seed straight into review with the generous
//     known-assert schedule. seedKnownAssertFacet's WHERE re-checks
//     eligibility atomically (and requires data_status='ready'), and does NOT
//     stamp introduced_at — bridged credit is free, never a daily-new slot.
//   - already-scheduled facet → an implicit FSRS 'good' under the facet row
//     lock (the serialization point every SRS writer shares).
// Parked facets are skipped in both shapes: rehab state is frozen against
// every implicit writer, and a leech-parked recognition facet SHOULD keep its
// gates — direct recognition failure outweighs derived production evidence.
export const bridgeRecognitionFromProduction = async (params: {
  lookup: DbUserLookup
  deps: RecognitionBridgeDependencies
}): Promise<void> => {
  const { lookup, deps } = params
  const address = {
    userLookupId: lookup.id,
    skill: 'meaning_recognition' as const,
    targetForm: CITATION_FORM,
  }
  // Seed-vs-refresh is decided on the LOCKED row: picking the branch from an
  // unlocked pre-read would let a concurrent recognition writer (a first
  // explicit rating, or an introduction undo) flip srs_state between read and
  // write, sending the bridge down a branch whose guard then no-ops.
  await deps.withTransaction(async (tx) => {
    const facet = await deps.studyFacetsRepository.getFacetForUpdate(address, tx)
    if (!facet || facet.disabled_at !== null || facet.leech_parked_at !== null) return

    if (facet.srs_state === null) {
      await deps.studyFacetsRepository.seedKnownAssertFacet({ ...address, ...knownAssertResult(new Date()) }, tx)
      return
    }

    const result = applyRating(mergeFacet(lookup, facet), 'good', new Date())
    await deps.studyFacetsRepository.applyFsrsResultForFacet(
      {
        ...address,
        state: result.state,
        due: result.due,
        stability: result.stability,
        difficulty: result.difficulty,
        lastReview: result.lastReview,
        reps: result.reps,
        lapses: result.lapses,
        learningSteps: result.learningSteps,
      },
      tx
    )
  })
}
