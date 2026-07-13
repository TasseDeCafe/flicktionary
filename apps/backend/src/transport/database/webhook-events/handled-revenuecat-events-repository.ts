import { sql, beginTx } from '../postgres-client'

export interface HandledRevenuecatEventsRepository {
  handleEventIdempotently: (eventId: string, processingFunction: () => Promise<void>) => Promise<boolean>
}

export const buildHandledRevenuecatEventsRepository = (): HandledRevenuecatEventsRepository => {
  const handleEventIdempotently = async (
    eventId: string,
    processingFunction: () => Promise<void>
  ): Promise<boolean> => {
    return await beginTx(async (tx) => {
      const insertResult = await tx`
        INSERT INTO handled_revenuecat_events (event_id)
        VALUES (${eventId})
        ON CONFLICT (event_id) DO NOTHING
        RETURNING id
      `

      if (insertResult.count > 0) {
        await processingFunction()
        return true
      }

      return false
    })
  }

  return {
    handleEventIdempotently,
  }
}

export const __countEventsByIds = async (eventIds: string | string[]): Promise<number> => {
  const ids = Array.isArray(eventIds) ? eventIds : [eventIds]
  const result = await sql`
    SELECT COUNT(*)::int as count
    FROM handled_revenuecat_events
    WHERE event_id = ANY(${ids})
  `
  return result[0].count
}
