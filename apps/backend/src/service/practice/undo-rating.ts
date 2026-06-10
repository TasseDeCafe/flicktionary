import type {
  PracticePool,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import {
  isLegalPoolSkill,
  type FacetSkill,
  type StudyFacetsRepositoryInterface,
} from '../../transport/database/study-facets/study-facets-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import type { WithTransaction } from './rate-term'

export type UndoRatingDependencies = {
  userLookupsRepository: UserLookupsRepositoryInterface
  studyFacetsRepository: StudyFacetsRepositoryInterface
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
  withTransaction: WithTransaction
}

export type UndoRatingResult =
  | { ok: true; undone: boolean }
  | { ok: false; reason: 'lookup_not_found' | 'illegal_pool_skill' }

// Revert one rating: restore the pool's SRS family from the event's prev_srs_*
// snapshot and tombstone the event (reverted_at). The review budget refunds
// itself — every budget query filters reverted_at IS NULL.
//
// `eventId` is the handle rateTerm returned for the rating being undone. Only
// the LATEST live event for (lookup, pool) may be reverted — its snapshot is
// the only one that describes the row's current state. If the passed event is
// no longer the latest (a later rating landed from another tab / reading
// mode), or is already reverted, or no live event exists, the undo is a
// stale-safe no-op: `{ undone: false }` (200), never an error — the client
// treats it as "unknown-but-consistent server state" and just requeues the
// card. The FOR UPDATE in findLatestLiveEventForUndo serializes concurrent
// undos so restore + markReverted apply at most once.
//
// No FSRS recompute and no warmExerciseBank: the caller immediately follows a
// successful undo with a fresh rateTerm, which re-runs all of that machinery.
export const undoRating = async (
  userLookupId: string,
  userId: string,
  pool: PracticePool,
  skill: FacetSkill,
  targetForm: string,
  eventId: string,
  deps: UndoRatingDependencies
): Promise<UndoRatingResult> => {
  if (!isLegalPoolSkill(pool, skill)) return { ok: false, reason: 'illegal_pool_skill' }

  const lookup = await deps.userLookupsRepository.findByIdForUser(userLookupId, userId)
  if (!lookup) return { ok: false, reason: 'lookup_not_found' }

  const undone = await deps.withTransaction(async (tx) => {
    // Address the latest live event by the FACET identity (skill, target_form),
    // not pool — the recognition queue can serve multiple facets per term.
    const event = await deps.practiceRatingEventsRepository.findLatestLiveEventForUndo(
      { userId, userLookupId, skill, targetForm },
      tx
    )
    if (!event || event.id !== eventId) return false
    await deps.studyFacetsRepository.restoreSrsSnapshotForFacet(
      {
        userLookupId,
        skill,
        targetForm,
        prevState: event.prev_srs_state,
        prevDue: event.prev_srs_due,
        prevStability: event.prev_srs_stability,
        prevDifficulty: event.prev_srs_difficulty,
        prevLastReview: event.prev_srs_last_review,
        prevReps: event.prev_srs_reps,
        prevLapses: event.prev_srs_lapses,
        wasIntroduction: event.was_introduction,
        causedParking: event.caused_parking,
      },
      tx
    )
    await deps.practiceRatingEventsRepository.markReverted({ eventId: event.id, userId }, tx)
    return true
  })

  return { ok: true, undone }
}
