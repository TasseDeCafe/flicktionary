import { randomUUID } from 'crypto'
import { logCustomErrorMessageAndError } from '../../../transport/third-party/sentry/error-monitoring'
import {
  DbProcessingJob,
  ProcessingJobsRepositoryInterface,
} from '../../../transport/database/processing-jobs/processing-jobs-repository'
import type { ProcessingDependencies } from '../../processing/processing-dependencies'
import { enrichHighlight } from '../../processing/enrich-highlight'
import { nominateWindow } from '../../processing/nominate-window'
import { seedCardChatFromNote } from '../../processing/seed-card-chat-from-note'

export interface EnrichmentWorkerInterface {
  initialize: () => void
  stop: () => void
}

// Poll cadence and lease/retry tuning. STALE_AFTER reclaims a lease held by a
// crashed worker; MAX_ATTEMPTS caps retries before a job is parked as failed
// (surfaced to the user with a retry affordance in the session vocabulary list).
const POLL_INTERVAL_MS = 2000
const BATCH_SIZE = 3
const STALE_AFTER_SECONDS = 5 * 60
const HEARTBEAT_INTERVAL_MS = 60 * 1000
const MAX_ATTEMPTS = 4
const BASE_BACKOFF_SECONDS = 5
const MAX_BACKOFF_SECONDS = 5 * 60

// In-process polling worker over the processing_jobs queue. Each tick claims a
// bounded batch (which also reclaims stale leases), dispatches each job by kind
// with concurrency capped at BATCH_SIZE, and marks it done or schedules a
// backoff retry. Ticks never overlap — a slow batch (LLM calls) holds the next
// tick until it finishes, which is what bounds concurrency.
export const EnrichmentWorker = (
  processingJobsRepository: ProcessingJobsRepositoryInterface,
  processingDependencies: ProcessingDependencies
): EnrichmentWorkerInterface => {
  const workerId = `enrichment-worker:${process.pid}:${randomUUID().slice(0, 8)}`
  let intervalId: NodeJS.Timeout | null = null
  let ticking = false

  const runJob = async (job: DbProcessingJob): Promise<void> => {
    const heartbeatId = setInterval(() => {
      void processingJobsRepository.refreshLease(job.id, workerId).catch((e) => {
        logCustomErrorMessageAndError(`refreshLease failed (id=${job.id})`, e)
      })
    }, HEARTBEAT_INTERVAL_MS)
    try {
      if (job.kind === 'enrich_highlight') {
        if (!job.highlight_id) throw new Error('enrich_highlight job missing highlight_id')
        await enrichHighlight(
          { sessionId: job.study_session_id, highlightId: job.highlight_id, userId: job.user_id },
          processingDependencies
        )
      } else if (job.kind === 'seed_card_chat') {
        if (!job.highlight_id) throw new Error('seed_card_chat job missing highlight_id')
        await seedCardChatFromNote(
          {
            jobId: job.id,
            sessionId: job.study_session_id,
            highlightId: job.highlight_id,
            userId: job.user_id,
          },
          processingDependencies
        )
      } else if (job.kind === 'nominate_window') {
        if (job.window_start_index === null || job.window_end_index === null) {
          throw new Error('nominate_window job missing window indices')
        }
        await nominateWindow(
          {
            sessionId: job.study_session_id,
            userId: job.user_id,
            startIndex: job.window_start_index,
            endIndex: job.window_end_index,
          },
          processingDependencies
        )
      } else {
        // Retired Phase-1 discovery jobs can still exist in old local queues or
        // the enum. Treat them as no-ops instead of retrying forever.
        logCustomErrorMessageAndError(
          `processing job kind retired (id=${job.id}, kind=${job.kind})`,
          new Error('retired processing job kind')
        )
      }
      const marked = await processingJobsRepository.markDone(job.id, workerId)
      if (!marked) {
        logCustomErrorMessageAndError(
          `markDone skipped because lease changed (id=${job.id}, workerId=${workerId})`,
          new Error('processing job lease changed before markDone')
        )
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logCustomErrorMessageAndError(`processing job failed (id=${job.id}, kind=${job.kind})`, e)
      const backoffSeconds = Math.min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * 2 ** Math.max(0, job.attempts - 1))
      await processingJobsRepository
        .markFailedOrRetry({ id: job.id, workerId, error: message, backoffSeconds, maxAttempts: MAX_ATTEMPTS })
        .then((updated) => {
          if (
            updated?.status === 'failed' &&
            job.kind === 'nominate_window' &&
            job.window_start_index !== null &&
            job.window_end_index !== null
          ) {
            return processingDependencies.nominatedWindowsRepository.markFailed({
              sessionId: job.study_session_id,
              startIndex: job.window_start_index,
              endIndex: job.window_end_index,
            })
          }
        })
        .catch((markErr) => logCustomErrorMessageAndError(`markFailedOrRetry failed (id=${job.id})`, markErr))
    } finally {
      clearInterval(heartbeatId)
    }
  }

  const tick = async (): Promise<void> => {
    if (ticking) return
    ticking = true
    try {
      const jobs = await processingJobsRepository.claimBatch(BATCH_SIZE, workerId, STALE_AFTER_SECONDS)
      if (jobs.length === 0) return
      await Promise.all(jobs.map(runJob))
    } catch (e) {
      logCustomErrorMessageAndError('enrichment worker tick failed', e)
    } finally {
      ticking = false
    }
  }

  return {
    initialize: (): void => {
      if (intervalId) return
      intervalId = setInterval(() => void tick(), POLL_INTERVAL_MS)
      console.log(`Enrichment worker started (${workerId})`)
    },
    stop: (): void => {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    },
  }
}

// No-op default so buildApp (used by mock/test runs) never spins a polling
// worker against the test DB — mirrors MockAccessCacheService. The real worker
// is constructed in server.ts and injected into buildApp.
export const MockEnrichmentWorker = (): EnrichmentWorkerInterface => {
  return {
    initialize: (): void => {
      // No-op: we never poll the DB in mock/test runs (avoids flaky races).
    },
    stop: (): void => {
      // No-op.
    },
  }
}
