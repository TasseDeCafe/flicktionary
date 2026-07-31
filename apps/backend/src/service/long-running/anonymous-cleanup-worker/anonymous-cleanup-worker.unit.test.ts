import { describe, expect, test, vi } from 'vitest'
import { AnonymousCleanupWorker } from './anonymous-cleanup-worker'

describe('anonymous-cleanup-worker', () => {
  test('tickOnce sweeps with the configured retention', async () => {
    const deleteStaleAnonymousUsers = vi.fn().mockResolvedValue(2)
    const worker = AnonymousCleanupWorker({ deleteStaleAnonymousUsers }, { intervalDays: 7, retentionDays: 30 })

    await worker.tickOnce()

    expect(deleteStaleAnonymousUsers).toHaveBeenCalledExactlyOnceWith(30)
  })

  test('a failing sweep is contained, not thrown', async () => {
    const deleteStaleAnonymousUsers = vi.fn().mockRejectedValue(new Error('db down'))
    const worker = AnonymousCleanupWorker({ deleteStaleAnonymousUsers }, { intervalDays: 7, retentionDays: 30 })

    await expect(worker.tickOnce()).resolves.toBeUndefined()
  })
})
