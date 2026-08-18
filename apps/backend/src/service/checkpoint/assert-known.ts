import { CITATION_FORM } from '../../transport/database/study-facets/study-facets-repository'
import type { BacklogEvidenceEntry } from '../../transport/database/study-sessions/study-session-checkpoints-repository'
import { knownAssertResult } from '../practice/fsrs'
import type { BacklogCandidate, CheckpointDependencies } from './collect-checkpoint'

export type AssertKnownResult = { ok: false; reason: 'not_found' } | { ok: true; asserted: number; skipped: number }

export type BacklogClaimsResult =
  { ok: false; reason: 'not_found' } | { ok: true; checkpointId: string | null; candidates: BacklogCandidate[] }

// Rehydrates the claims sheet after a remount: the collect response's backlog
// candidates live only in client memory, but the ids persist on the checkpoint
// row — re-offer the ones still assertable (same eligibility the seed guards
// enforce, so an id asserted or introduced since simply drops out). Only the
// latest LIVE checkpoint is offered: assert-known accepts any live checkpoint,
// but earlier checkpoints' leftovers re-surface through later spans instead.
export const listBacklogClaims = async (
  params: { sessionId: string; userId: string },
  deps: CheckpointDependencies
): Promise<BacklogClaimsResult> => {
  const session = await deps.studySessionsRepository.findByIdForUser(params.sessionId, params.userId)
  if (!session) return { ok: false, reason: 'not_found' }
  const checkpoint = await deps.studySessionCheckpointsRepository.findLatestLiveBySession(
    params.sessionId,
    params.userId
  )
  if (!checkpoint) return { ok: true, checkpointId: null, candidates: [] }
  const rows = await deps.userLookupsRepository.listAssertableBacklogCandidates({
    userId: params.userId,
    userLookupIds: checkpoint.backlog_candidate_ids,
  })
  // Preserve the checkpoint's stored candidate order (the collect's backlog
  // ordering) rather than the join's row order. Evidence rehydrates from the
  // checkpoint row; rows predating the column fall back to null fields.
  const evidence = (checkpoint.backlog_evidence ?? {}) as Record<string, BacklogEvidenceEntry>
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const candidates = checkpoint.backlog_candidate_ids.flatMap((id) => {
    const row = rowById.get(id)
    if (!row) return []
    return [
      {
        userLookupId: row.id,
        headword: row.headword,
        sense: row.sense,
        matchedSurface: evidence[id]?.surface ?? null,
        context: evidence[id]?.context ?? null,
      },
    ]
  })
  return { ok: true, checkpointId: checkpoint.id, candidates }
}

export type UndoKnownAssertionsResult =
  { ok: false; reason: 'not_found' } | { ok: true; reverted: number; skipped: number }

// The backlog "I already know this" action (docs/SRS.md §6c): seed the
// selected never-introduced recognition facets straight into review state
// with the generous known-assert schedule. SERVER-AUTHORITATIVE: only ids in
// the checkpoint's stored backlog_candidate_ids may be asserted — the client
// can pick a subset, never widen the set. Two write paths, one action:
//   - never-introduced, unparked → plain seed; event logs was_introduction
//     (undo restores srs_state NULL; the introduced_at-clearing is a harmless
//     no-op since it was never stamped);
//   - onboarding-parked (srs_state NULL + leech_parked_at) → the assertion
//     EXITS onboarding: unpark + seed; event logs caused_unparking + the full
//     prior park snapshot (incl. partial rehab progress) so undo re-parks
//     exactly. introduced_at (stamped at park time) is untouched.
// Facets whose state changed since the checkpoint (introduced, leech-parked
// with history, disabled, pending) are skipped, not errors. Never touches the
// daily-new budget: no introduced_at stamp; the review budget is untouched
// too (NULL-path events are was_introduction=TRUE; parked-path events fail
// the budget's prev_srs_state IN ('new','review') filter).
export const assertKnownBacklog = async (
  params: { sessionId: string; checkpointId: string; userId: string; userLookupIds: readonly string[] },
  deps: CheckpointDependencies
): Promise<AssertKnownResult> => {
  const checkpoint = await deps.studySessionCheckpointsRepository.findByIdForUser(params.checkpointId, params.userId)
  if (!checkpoint || checkpoint.study_session_id !== params.sessionId || checkpoint.reverted_at !== null) {
    return { ok: false, reason: 'not_found' }
  }
  const candidateIds = new Set(checkpoint.backlog_candidate_ids)

  const result = await deps.withTransaction(async (tx) => {
    let asserted = 0
    let skipped = 0
    const seen = new Set<string>()
    // Sorted iteration = the shared multi-facet lock order (user_lookup_id
    // asc), deadlock-free against the batch-undo loops.
    for (const userLookupId of [...params.userLookupIds].sort()) {
      if (seen.has(userLookupId)) continue
      seen.add(userLookupId)
      if (!candidateIds.has(userLookupId)) {
        skipped++
        continue
      }
      const lookup = await deps.userLookupsRepository.findByIdForUser(userLookupId, params.userId)
      if (!lookup) {
        skipped++
        continue
      }
      // Row lock: the eligibility check and the seed/park snapshot below must
      // describe the same state a concurrent rating or undo can't move.
      const facet = await deps.studyFacetsRepository.getFacetForUpdate(
        { userLookupId, skill: 'meaning_recognition', targetForm: CITATION_FORM },
        tx
      )
      if (!facet || facet.srs_state !== null || facet.disabled_at !== null || facet.data_status !== 'ready') {
        skipped++
        continue
      }
      const seed = knownAssertResult(new Date())
      const isParked = facet.leech_parked_at !== null
      const applied = isParked
        ? await deps.studyFacetsRepository.seedKnownAssertParkedFacet(
            { userLookupId, skill: 'meaning_recognition', targetForm: CITATION_FORM, ...seed },
            tx
          )
        : await deps.studyFacetsRepository.seedKnownAssertFacet(
            { userLookupId, skill: 'meaning_recognition', targetForm: CITATION_FORM, ...seed },
            tx
          )
      if (!applied) {
        skipped++
        continue
      }
      await deps.practiceRatingEventsRepository.insert(
        {
          userId: params.userId,
          userLookupId,
          targetLanguage: lookup.target_language,
          pool: 'recognition',
          skill: 'meaning_recognition',
          targetForm: CITATION_FORM,
          rating: 'good',
          // was_explicit discriminates the two lanes sharing checkpoint_id:
          // implicit credits are false, assertions are true.
          wasExplicit: true,
          wasIntroduction: !isParked,
          causedParking: false,
          causedUnparking: isParked,
          prevLeechParkedAt: isParked ? facet.leech_parked_at : null,
          prevLeechRehabCorrectDays: isParked ? facet.leech_rehab_correct_days : null,
          prevLeechRehabLastCorrectOn: isParked ? facet.leech_rehab_last_correct_on : null,
          practiceTextId: null,
          studySessionId: params.sessionId,
          checkpointId: params.checkpointId,
          headword: lookup.headword,
          sense: lookup.sense ?? '',
          prevSrsState: null,
          prevSrsDue: null,
          prevSrsStability: null,
          prevSrsDifficulty: null,
          prevSrsLastReview: null,
          prevSrsReps: null,
          prevSrsLapses: null,
          prevSrsLearningSteps: null,
        },
        tx
      )
      asserted++
    }
    return { asserted, skipped }
  })

  return { ok: true, ...result }
}

// Batch undo of one checkpoint's known-assertions — the assertion lane
// (was_explicit=TRUE) only; fully independent of checkpoint undo (no pointer
// change, no latest-checkpoint requirement — assertions are a deliberate
// second step and stay undoable even after the checkpoint itself was
// reverted). Facets rated since are skipped via the latest-live-event check.
export const undoKnownAssertions = async (
  params: { sessionId: string; checkpointId: string; userId: string },
  deps: CheckpointDependencies
): Promise<UndoKnownAssertionsResult> => {
  const checkpoint = await deps.studySessionCheckpointsRepository.findByIdForUser(params.checkpointId, params.userId)
  if (!checkpoint || checkpoint.study_session_id !== params.sessionId) return { ok: false, reason: 'not_found' }

  const result = await deps.withTransaction(async (tx) => {
    const events = await deps.practiceRatingEventsRepository.listLiveEventsForCheckpoint(
      { checkpointId: params.checkpointId, userId: params.userId, wasExplicit: true },
      tx
    )
    let reverted = 0
    let skipped = 0
    // Same order + facet-lock-first discipline as undoCheckpoint's loop (see
    // there): lock the facet row, then re-check the latest-event invariant.
    const ordered = [...events].sort((a, b) => a.user_lookup_id.localeCompare(b.user_lookup_id))
    for (const event of ordered) {
      await deps.studyFacetsRepository.getFacetForUpdate(
        { userLookupId: event.user_lookup_id, skill: 'meaning_recognition', targetForm: event.target_form },
        tx
      )
      const latestEvent = await deps.practiceRatingEventsRepository.findLatestLiveEventForUndo(
        {
          userId: params.userId,
          userLookupId: event.user_lookup_id,
          skill: 'meaning_recognition',
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
          skill: 'meaning_recognition',
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
          causedUnparking: event.caused_unparking,
          prevLeechParkedAt: event.prev_leech_parked_at,
          prevLeechRehabCorrectDays: event.prev_leech_rehab_correct_days,
          prevLeechRehabLastCorrectOn: event.prev_leech_rehab_last_correct_on,
        },
        tx
      )
      await deps.practiceRatingEventsRepository.markReverted({ eventId: event.id, userId: params.userId }, tx)
      reverted++
    }
    return { reverted, skipped }
  })

  return { ok: true, ...result }
}
