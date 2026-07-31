import { logCustomErrorMessageAndError } from '../../../transport/error-monitoring/error-monitoring'
import type { AuthUsersRepository } from '../../../transport/database/auth-users/auth-users-repository'

export interface AnonymousCleanupWorkerInterface {
  initialize: () => void
  stop: () => void
  // One sweep, bypassing the interval gate — tests drive the worker through
  // this instead of waiting out real-time scheduling.
  tickOnce: () => Promise<void>
}

// The sweep interval is checked hourly against the last completed sweep
// instead of armed as one long setInterval: Node truncates timer delays above
// ~24.8 days to 1ms, which would turn a large configured interval into a hot
// loop.
const CHECK_INTERVAL_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// Periodic deletion of guest accounts that never converted to an email
// account (ANON_CLEANUP_INTERVAL_DAYS / ANON_RETENTION_DAYS in Doppler,
// defaults 7 / 30).
export const AnonymousCleanupWorker = (
  authUsersRepository: Pick<AuthUsersRepository, 'deleteStaleAnonymousUsers'>,
  config: { intervalDays: number; retentionDays: number }
): AnonymousCleanupWorkerInterface => {
  let intervalId: NodeJS.Timeout | null = null
  let lastSweepAtMs = 0
  let ticking = false

  const tick = async (): Promise<void> => {
    if (ticking) return
    ticking = true
    lastSweepAtMs = Date.now()
    try {
      const deletedCount = await authUsersRepository.deleteStaleAnonymousUsers(config.retentionDays)
      console.log(
        `Anonymous cleanup: deleted ${deletedCount} stale guest account(s) (retention ${config.retentionDays} days)`
      )
    } catch (e) {
      logCustomErrorMessageAndError('anonymous cleanup sweep failed', e)
    } finally {
      ticking = false
    }
  }

  return {
    initialize: (): void => {
      if (intervalId) return
      // Deploys restart the process far more often than the interval elapses,
      // so a sweep also runs at every boot — without this a weekly timer
      // might never fire, and the DELETE is idempotent and cheap.
      void tick()
      intervalId = setInterval(() => {
        if (Date.now() - lastSweepAtMs >= config.intervalDays * DAY_MS) void tick()
      }, CHECK_INTERVAL_MS)
      console.log(
        `Anonymous cleanup worker started (interval ${config.intervalDays} days, retention ${config.retentionDays} days)`
      )
    },
    stop: (): void => {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    },
    tickOnce: tick,
  }
}

// No-op default so buildApp (used by mock/test runs) never sweeps the shared
// test DB in the background — mirrors MockEnrichmentWorker. The real worker
// is constructed in server.ts and injected into buildApp.
export const MockAnonymousCleanupWorker = (): AnonymousCleanupWorkerInterface => {
  return {
    initialize: (): void => {
      // No-op.
    },
    stop: (): void => {
      // No-op.
    },
    tickOnce: async (): Promise<void> => {
      // No-op.
    },
  }
}
