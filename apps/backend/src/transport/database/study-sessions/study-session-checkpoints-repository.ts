import type postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

// One row per checkpoint press ("I've followed up to here"). The row is the
// batch-undo handle — implicit credits reference it via
// practice_rating_events.checkpoint_id — and `backlog_candidate_ids` is the
// server-authoritative claim set the known-assertion action verifies against.
export type DbStudySessionCheckpoint = Tables<'study_session_checkpoints'>

const insert = async (
  params: {
    userId: string
    studySessionId: string
    fromSegmentIndex: number | null
    toSegmentIndex: number
    creditedCount: number
    backlogCandidateIds: string[]
  },
  executor: postgres.Sql = sql
): Promise<DbStudySessionCheckpoint> => {
  const rows = (await executor`
    INSERT INTO public.study_session_checkpoints (
      user_id, study_session_id, from_segment_index, to_segment_index,
      credited_count, backlog_candidate_ids
    )
    VALUES (
      ${params.userId},
      ${params.studySessionId},
      ${params.fromSegmentIndex},
      ${params.toSegmentIndex},
      ${params.creditedCount},
      ${params.backlogCandidateIds}::uuid[]
    )
    RETURNING *
  `) as DbStudySessionCheckpoint[]
  return rows[0]!
}

const findByIdForUser = async (checkpointId: string, userId: string): Promise<DbStudySessionCheckpoint | null> => {
  const rows = (await sql`
    SELECT * FROM public.study_session_checkpoints
    WHERE id = ${checkpointId} AND user_id = ${userId}
  `) as DbStudySessionCheckpoint[]
  return rows[0] ?? null
}

// The session's most recent non-reverted checkpoint — the only one undo may
// revert (later checkpoints' spans build on this one's pointer).
const findLatestLiveBySession = async (
  studySessionId: string,
  userId: string,
  executor: postgres.Sql = sql
): Promise<DbStudySessionCheckpoint | null> => {
  const rows = (await executor`
    SELECT * FROM public.study_session_checkpoints
    WHERE study_session_id = ${studySessionId}
      AND user_id = ${userId}
      AND reverted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `) as DbStudySessionCheckpoint[]
  return rows[0] ?? null
}

// FOR UPDATE re-read inside the undo transaction: serializes concurrent undos
// of the same checkpoint (the loser re-reads reverted_at and no-ops).
const lockByIdForUpdate = async (
  checkpointId: string,
  userId: string,
  executor: postgres.Sql
): Promise<DbStudySessionCheckpoint | null> => {
  const rows = (await executor`
    SELECT * FROM public.study_session_checkpoints
    WHERE id = ${checkpointId} AND user_id = ${userId}
    FOR UPDATE
  `) as DbStudySessionCheckpoint[]
  return rows[0] ?? null
}

const markReverted = async (checkpointId: string, userId: string, executor: postgres.Sql = sql): Promise<void> => {
  await executor`
    UPDATE public.study_session_checkpoints
    SET reverted_at = NOW()
    WHERE id = ${checkpointId} AND user_id = ${userId} AND reverted_at IS NULL
  `
}

export interface StudySessionCheckpointsRepositoryInterface {
  insert: (
    params: {
      userId: string
      studySessionId: string
      fromSegmentIndex: number | null
      toSegmentIndex: number
      creditedCount: number
      backlogCandidateIds: string[]
    },
    executor?: postgres.Sql
  ) => Promise<DbStudySessionCheckpoint>
  findByIdForUser: (checkpointId: string, userId: string) => Promise<DbStudySessionCheckpoint | null>
  findLatestLiveBySession: (
    studySessionId: string,
    userId: string,
    executor?: postgres.Sql
  ) => Promise<DbStudySessionCheckpoint | null>
  lockByIdForUpdate: (
    checkpointId: string,
    userId: string,
    executor: postgres.Sql
  ) => Promise<DbStudySessionCheckpoint | null>
  markReverted: (checkpointId: string, userId: string, executor?: postgres.Sql) => Promise<void>
}

export const StudySessionCheckpointsRepository = (): StudySessionCheckpointsRepositoryInterface => {
  return {
    insert,
    findByIdForUser,
    findLatestLiveBySession,
    lockByIdForUpdate,
    markReverted,
  }
}
