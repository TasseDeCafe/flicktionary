import type { FacetSkill } from '../../transport/database/study-facets/study-facets-repository'
import type { CheckpointDependencies } from './collect-checkpoint'

export type UndoCheckpointResult =
  { ok: false; reason: 'not_found' } | { ok: true; undone: boolean; reverted: number; skipped: number }

// Batch undo of one checkpoint's implicit credits. Only the session's LATEST
// live checkpoint may be undone — later checkpoints' spans build on this one's
// pointer, so reverting an older one would corrupt the monotonic history. A
// stale press (not latest, or already reverted) is a no-op ({undone:false}),
// never an error.
//
// Per event, the "latest live event per facet" invariant is re-checked under
// FOR UPDATE: a facet rated again after the checkpoint (flashcards interleave
// freely with reading) keeps its newer rating and is skipped — partial undo,
// reported via the counts. Content-encounter aggregates are NOT reverted
// (accepted noise; they carry no scheduling weight).
export const undoCheckpoint = async (
  params: { sessionId: string; checkpointId: string; userId: string },
  deps: CheckpointDependencies
): Promise<UndoCheckpointResult> => {
  const checkpoint = await deps.studySessionCheckpointsRepository.findByIdForUser(params.checkpointId, params.userId)
  if (!checkpoint || checkpoint.study_session_id !== params.sessionId) return { ok: false, reason: 'not_found' }

  const result = await deps.withTransaction(async (tx) => {
    // FOR UPDATE serializes concurrent undos of the same checkpoint; the
    // loser re-reads reverted_at and no-ops.
    const locked = await deps.studySessionCheckpointsRepository.lockByIdForUpdate(
      params.checkpointId,
      params.userId,
      tx
    )
    if (!locked || locked.reverted_at !== null) return { undone: false, reverted: 0, skipped: 0 }
    const latest = await deps.studySessionCheckpointsRepository.findLatestLiveBySession(
      params.sessionId,
      params.userId,
      tx
    )
    if (!latest || latest.id !== params.checkpointId) return { undone: false, reverted: 0, skipped: 0 }

    const events = await deps.practiceRatingEventsRepository.listLiveEventsForCheckpoint(
      { checkpointId: params.checkpointId, userId: params.userId, wasExplicit: false },
      tx
    )
    let reverted = 0
    let skipped = 0
    for (const event of events) {
      const latestEvent = await deps.practiceRatingEventsRepository.findLatestLiveEventForUndo(
        {
          userId: params.userId,
          userLookupId: event.user_lookup_id,
          skill: event.skill as FacetSkill,
          targetForm: event.target_form,
        },
        tx
      )
      if (!latestEvent || latestEvent.id !== event.id) {
        skipped++
        continue
      }
      await deps.studyFacetsRepository.restoreSrsSnapshotForFacet(
        {
          userLookupId: event.user_lookup_id,
          skill: event.skill as FacetSkill,
          targetForm: event.target_form,
          prevState: event.prev_srs_state,
          prevDue: event.prev_srs_due,
          prevStability: event.prev_srs_stability,
          prevDifficulty: event.prev_srs_difficulty,
          prevLastReview: event.prev_srs_last_review,
          prevReps: event.prev_srs_reps,
          prevLapses: event.prev_srs_lapses,
          prevLearningSteps: event.prev_srs_learning_steps,
          wasIntroduction: event.was_introduction,
          causedParking: event.caused_parking,
        },
        tx
      )
      await deps.practiceRatingEventsRepository.markReverted({ eventId: event.id, userId: params.userId }, tx)
      reverted++
    }

    // Exact pointer restore — including NULL for a first checkpoint (the
    // never-checkpointed state, not -1).
    await deps.studySessionsRepository.restoreReviewedUntil(
      params.sessionId,
      params.userId,
      checkpoint.from_segment_index,
      tx
    )
    await deps.studySessionCheckpointsRepository.markReverted(params.checkpointId, params.userId, tx)
    return { undone: true, reverted, skipped }
  })

  return { ok: true, ...result }
}
