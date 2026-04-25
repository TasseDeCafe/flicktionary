import { logWithSentry } from '../../third-party/sentry/error-monitoring'
import { sql } from '../postgres-client'

export interface HandledRevenuecatEventsRepository {
  handleEventIdempotently: (eventId: string, processingFunction: () => Promise<void>) => Promise<boolean>
}

export const buildHandledRevenuecatEventsRepository = (): HandledRevenuecatEventsRepository => {
  const handleEventIdempotently = async (
    eventId: string,
    processingFunction: () => Promise<void>
  ): Promise<boolean> => {
    try {
      return await sql.begin(async (sql) => {
        // todo: remove 'as any' when TransactionSql call signature is fixed: https://github.com/porsager/postgres/issues/1150
        /* eslint-disable  @typescript-eslint/no-explicit-any */
        const insertResult = await (sql as any)`
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
    } catch (error) {
      logWithSentry({ message: 'Error processing Revenuecat event', params: { eventId }, error })
      throw error
    }
  }

  return {
    handleEventIdempotently,
  }
}

export const __deleteAllHandledRevenuecatEvents = async () => {
  await sql`DELETE FROM handled_revenuecat_events`
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

export const __countAllEvents = async (): Promise<number> => {
  const result = await sql`
    SELECT COUNT(*)::int as count
    FROM handled_revenuecat_events
  `
  return result[0].count
}
