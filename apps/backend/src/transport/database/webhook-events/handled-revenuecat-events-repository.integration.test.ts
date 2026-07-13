import { describe, expect, it } from 'vitest'
import { __countEventsByIds, buildHandledRevenuecatEventsRepository } from './handled-revenuecat-events-repository'
import { __generateUniqueId } from '../../../test/test-utils'

describe('handled-revenuecat-events-repository', () => {
  const repository = buildHandledRevenuecatEventsRepository()

  describe('handleEventIdempotently', () => {
    it('should process an event only once', async () => {
      const eventId = __generateUniqueId('evt')
      let processCount = 0
      const processingFunction = async () => {
        processCount++
      }

      const firstResult = await repository.handleEventIdempotently(eventId, processingFunction)
      expect(firstResult).toBe(true)
      expect(processCount).toBe(1)

      const secondResult = await repository.handleEventIdempotently(eventId, processingFunction)
      expect(secondResult).toBe(false)
      expect(processCount).toBe(1)
    })

    it('should handle multiple different events', async () => {
      const eventIds = [__generateUniqueId('evt'), __generateUniqueId('evt'), __generateUniqueId('evt')]
      const processedEvents = new Set<string>()
      const createProcessingFunction = (eventId: string) => async () => {
        processedEvents.add(eventId)
      }

      await Promise.all(
        eventIds.map((eventId) => repository.handleEventIdempotently(eventId, createProcessingFunction(eventId)))
      )

      expect(processedEvents.size).toBe(3)

      const count = await __countEventsByIds(eventIds)
      expect(count).toBe(3)
    })

    it('should handle concurrent requests for the same event', async () => {
      const eventId = __generateUniqueId('evt')
      let processCount = 0
      const processingFunction = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100)) // Simulate some long-running work
        processCount++
      }

      const results = await Promise.all([
        repository.handleEventIdempotently(eventId, processingFunction),
        repository.handleEventIdempotently(eventId, processingFunction),
        repository.handleEventIdempotently(eventId, processingFunction),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
      expect(processCount).toBe(1)

      const count = await __countEventsByIds(eventId)
      expect(count).toBe(1)
    })

    it('should propagate errors from processing function', async () => {
      const eventId = __generateUniqueId('evt')
      const processingFunction = async () => {
        throw new Error('Processing failed')
      }

      await expect(repository.handleEventIdempotently(eventId, processingFunction)).rejects.toThrow('Processing failed')

      const count = await __countEventsByIds(eventId)
      expect(count).toBe(0)
    })
  })
})
