import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbProcessingJob = Tables<'processing_jobs'>

export type EnqueueJobInput = {
  kind: 'enrich_highlight'
  sessionId: string
  userId: string
  highlightId: string
  // Absolute time the job becomes claimable. Defaults to now() — pass a future
  // time to debounce (absorb mis-selections before enriching a highlight).
  runAfter?: Date | null
}

// Idempotent per LIVE (pending/processing) highlight enrichment job. Returns the
// inserted row, or null when an in-flight job already covered this highlight and
// DO NOTHING fired.
const enqueue = async (params: EnqueueJobInput): Promise<DbProcessingJob | null> => {
  const runAfter = params.runAfter ?? null
  const result = (await sql`
    INSERT INTO public.processing_jobs (kind, study_session_id, highlight_id, user_id, run_after)
    VALUES (
      'enrich_highlight',
      ${params.sessionId},
      ${params.highlightId},
      ${params.userId},
      ${runAfter ?? sql`now()`}
    )
    ON CONFLICT (highlight_id) WHERE highlight_id IS NOT NULL AND status IN ('pending', 'processing')
    DO NOTHING
    RETURNING *
  `) as DbProcessingJob[]
  return result[0] ?? null
}

// Atomically claim up to `limit` runnable jobs: due pending rows, plus stale
// processing rows whose lease (locked_at) is older than `staleAfterSeconds` —
// the lease-reclaim path that recovers work orphaned by a crashed worker.
// FOR UPDATE SKIP LOCKED lets concurrent workers claim disjoint batches without
// blocking. Increments attempts so retry/backoff accounting starts at claim.
const claimBatch = async (limit: number, workerId: string, staleAfterSeconds: number): Promise<DbProcessingJob[]> => {
  return (await sql`
    WITH claimed AS (
      SELECT id FROM public.processing_jobs
      WHERE (status = 'pending' AND run_after <= now())
         OR (status = 'processing' AND locked_at < now() - make_interval(secs => ${staleAfterSeconds}))
      ORDER BY run_after
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.processing_jobs j
    SET status = 'processing',
        locked_at = now(),
        locked_by = ${workerId},
        attempts = attempts + 1,
        updated_at = now()
    FROM claimed
    WHERE j.id = claimed.id
    RETURNING j.*
  `) as DbProcessingJob[]
}

const refreshLease = async (id: string, workerId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.processing_jobs
    SET locked_at = now(), updated_at = now()
    WHERE id = ${id} AND locked_by = ${workerId} AND status = 'processing'
  `
  return result.count === 1
}

const markDone = async (id: string, workerId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.processing_jobs
    SET status = 'done', locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE id = ${id} AND locked_by = ${workerId}
  `
  return result.count === 1
}

// Release the lease and either schedule a backoff retry or, once attempts have
// exhausted maxAttempts, park the job as failed. attempts was already bumped at
// claim time, so we compare against the post-claim value.
const markFailedOrRetry = async (params: {
  id: string
  workerId: string
  error: string
  backoffSeconds: number
  maxAttempts: number
}): Promise<DbProcessingJob | null> => {
  const result = (await sql`
    UPDATE public.processing_jobs
    SET status = CASE WHEN attempts >= ${params.maxAttempts} THEN 'failed'::public.processing_job_status
                      ELSE 'pending'::public.processing_job_status END,
        last_error = ${params.error},
        run_after = CASE WHEN attempts >= ${params.maxAttempts} THEN run_after
                         ELSE now() + make_interval(secs => ${params.backoffSeconds}) END,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
    WHERE id = ${params.id} AND locked_by = ${params.workerId}
    RETURNING *
  `) as DbProcessingJob[]
  return result[0] ?? null
}

// Retry affordance: flip a failed enrich job for this highlight back to pending
// with a clean slate so the worker picks it up again.
const requeueFailedByHighlightId = async (params: {
  sessionId: string
  highlightId: string
}): Promise<DbProcessingJob | null> => {
  const result = (await sql`
    UPDATE public.processing_jobs
    SET status = 'pending', attempts = 0, last_error = NULL, run_after = now(),
        locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE study_session_id = ${params.sessionId}
      AND highlight_id = ${params.highlightId}
      AND status = 'failed'
    RETURNING *
  `) as DbProcessingJob[]
  return result[0] ?? null
}

// All non-terminal (or failed) jobs for a session, for the triage status read:
// which highlights are still enriching, and which failed.
const listActiveBySession = async (sessionId: string): Promise<DbProcessingJob[]> => {
  return (await sql`
    SELECT * FROM public.processing_jobs
    WHERE study_session_id = ${sessionId} AND status <> 'done'
    ORDER BY created_at ASC
  `) as DbProcessingJob[]
}

export interface ProcessingJobsRepositoryInterface {
  enqueue: (params: EnqueueJobInput) => Promise<DbProcessingJob | null>
  claimBatch: (limit: number, workerId: string, staleAfterSeconds: number) => Promise<DbProcessingJob[]>
  refreshLease: (id: string, workerId: string) => Promise<boolean>
  markDone: (id: string, workerId: string) => Promise<boolean>
  markFailedOrRetry: (params: {
    id: string
    workerId: string
    error: string
    backoffSeconds: number
    maxAttempts: number
  }) => Promise<DbProcessingJob | null>
  requeueFailedByHighlightId: (params: { sessionId: string; highlightId: string }) => Promise<DbProcessingJob | null>
  listActiveBySession: (sessionId: string) => Promise<DbProcessingJob[]>
}

export const ProcessingJobsRepository = (): ProcessingJobsRepositoryInterface => {
  return {
    enqueue,
    claimBatch,
    refreshLease,
    markDone,
    markFailedOrRetry,
    requeueFailedByHighlightId,
    listActiveBySession,
  }
}
