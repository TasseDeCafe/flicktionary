import { beforeEach, describe, expect, it } from 'vitest'
import {
  __deleteAllHandledRevenuecatEvents,
  __countEventsByIds,
  __countAllEvents,
  buildHandledRevenuecatEventsRepository,
} from './handled-revenuecat-events-repository'

describe('handled-revenuecat-events-repository', () => {
  const repository = buildHandledRevenuecatEventsRepository()

  beforeEach(async () => {
    await __deleteAllHandledRevenuecatEvents()
  })

  describe('handleEventIdempotently', () => {
    it('should process an event only once', async () => {
      let processCount = 0
      const processingFunction = async () => {
        processCount++
      }

      const firstResult = await repository.handleEventIdempotently('test_event_1', processingFunction)
      expect(firstResult).toBe(true)
      expect(processCount).toBe(1)

      const secondResult = await repository.handleEventIdempotently('test_event_1', processingFunction)
      expect(secondResult).toBe(false)
      expect(processCount).toBe(1)
    })

    it('should handle multiple different events', async () => {
      const processedEvents = new Set<string>()
      const createProcessingFunction = (eventId: string) => async () => {
        processedEvents.add(eventId)
      }

      await Promise.all([
        repository.handleEventIdempotently('test_event_1', createProcessingFunction('test_event_1')),
        repository.handleEventIdempotently('test_event_2', createProcessingFunction('test_event_2')),
        repository.handleEventIdempotently('test_event_3', createProcessingFunction('test_event_3')),
      ])

      expect(processedEvents.size).toBe(3)

      const count = await __countEventsByIds(['test_event_1', 'test_event_2', 'test_event_3'])
      expect(count).toBe(3)
    })

    it('should handle concurrent requests for the same event', async () => {
      let processCount = 0
      const processingFunction = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100)) // Simulate some long-running work
        processCount++
      }

      const results = await Promise.all([
        repository.handleEventIdempotently('concurrent_event', processingFunction),
        repository.handleEventIdempotently('concurrent_event', processingFunction),
        repository.handleEventIdempotently('concurrent_event', processingFunction),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
      expect(processCount).toBe(1)

      const count = await __countEventsByIds('concurrent_event')
      expect(count).toBe(1)
    })

    it('should propagate errors from processing function', async () => {
      const processingFunction = async () => {
        throw new Error('Processing failed')
      }

      await expect(repository.handleEventIdempotently('error_event', processingFunction)).rejects.toThrow(
        'Processing failed'
      )

      const count = await __countEventsByIds('error_event')
      expect(count).toBe(0)
    })
  })

  describe('__deleteAllHandledRevenuecatEvents', () => {
    it('should delete all handled events', async () => {
      const processingFunction = async () => {}
      await Promise.all([
        repository.handleEventIdempotently('cleanup_test_1', processingFunction),
        repository.handleEventIdempotently('cleanup_test_2', processingFunction),
        repository.handleEventIdempotently('cleanup_test_3', processingFunction),
      ])

      let count = await __countAllEvents()
      expect(count).toBeGreaterThan(0)

      await __deleteAllHandledRevenuecatEvents()

      count = await __countAllEvents()
      expect(count).toBe(0)
    })
  })
})
