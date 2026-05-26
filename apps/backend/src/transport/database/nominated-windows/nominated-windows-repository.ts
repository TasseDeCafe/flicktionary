import { sql, beginTx } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbNominatedWindow = Tables<'nominated_windows'>

// Idempotently claim a reading window and enqueue its nominate job in the same
// transaction. If the job insert fails, the coverage row rolls back too, so the
// client can request the window again instead of getting stuck with a pending
// covered window that has no worker job.
const requestWindowAndEnqueueJob = async (params: {
  sessionId: string
  userId: string
  startIndex: number
  endIndex: number
}): Promise<DbNominatedWindow | null> => {
  return await beginTx(async (tx) => {
    const result = (await tx`
      INSERT INTO public.nominated_windows (study_session_id, start_index, end_index)
      VALUES (${params.sessionId}, ${params.startIndex}, ${params.endIndex})
      ON CONFLICT (study_session_id, start_index, end_index) DO NOTHING
      RETURNING *
    `) as DbNominatedWindow[]
    const window = result[0] ?? null
    if (!window) return null
    await tx`
      INSERT INTO public.processing_jobs (kind, study_session_id, user_id, window_start_index, window_end_index)
      VALUES ('nominate_window', ${params.sessionId}, ${params.userId}, ${params.startIndex}, ${params.endIndex})
    `
    return window
  })
}

// Coverage set seeded to the client so it never re-requests a window it (or an
// earlier session) already covered, and so reloads resume where reading left off.
const listBySession = async (sessionId: string): Promise<DbNominatedWindow[]> => {
  return (await sql`
    SELECT * FROM public.nominated_windows
    WHERE study_session_id = ${sessionId}
    ORDER BY start_index ASC
  `) as DbNominatedWindow[]
}

// Mark a window done once its nominate pass has persisted (or yielded nothing).
const markDone = async (params: { sessionId: string; startIndex: number; endIndex: number }): Promise<void> => {
  await sql`
    UPDATE public.nominated_windows
    SET status = 'done', updated_at = now()
    WHERE study_session_id = ${params.sessionId}
      AND start_index = ${params.startIndex}
      AND end_index = ${params.endIndex}
  `
}

// Mark a window terminal when its nominate job exhausted retries. The client treats
// failed as covered for dedupe, but does not keep polling forever.
const markFailed = async (params: { sessionId: string; startIndex: number; endIndex: number }): Promise<void> => {
  await sql`
    UPDATE public.nominated_windows
    SET status = 'failed', updated_at = now()
    WHERE study_session_id = ${params.sessionId}
      AND start_index = ${params.startIndex}
      AND end_index = ${params.endIndex}
  `
}

export interface NominatedWindowsRepositoryInterface {
  requestWindowAndEnqueueJob: (params: {
    sessionId: string
    userId: string
    startIndex: number
    endIndex: number
  }) => Promise<DbNominatedWindow | null>
  listBySession: (sessionId: string) => Promise<DbNominatedWindow[]>
  markDone: (params: { sessionId: string; startIndex: number; endIndex: number }) => Promise<void>
  markFailed: (params: { sessionId: string; startIndex: number; endIndex: number }) => Promise<void>
}

export const NominatedWindowsRepository = (): NominatedWindowsRepositoryInterface => {
  return {
    requestWindowAndEnqueueJob,
    listBySession,
    markDone,
    markFailed,
  }
}
