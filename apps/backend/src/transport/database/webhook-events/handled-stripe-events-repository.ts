import { sql } from '../postgres-client'
import { logCustomErrorMessageAndError } from '../../third-party/sentry/error-monitoring'

export const handleEventIdempotently = async (
  eventId: string,
  processingFunction: () => Promise<void>
): Promise<boolean> => {
  let wasInserted = false
  try {
    const insertResult = await sql.begin(async (sql) => {
      // todo: remove 'as any' when TransactionSql call signature is fixed: https://github.com/porsager/postgres/issues/1150
      /* eslint-disable  @typescript-eslint/no-explicit-any */
      return (sql as any)`
        INSERT INTO handled_stripe_events (event_id)
        VALUES (${eventId})
        ON CONFLICT (event_id) DO NOTHING
        RETURNING id
      `
    })

    if (!insertResult || insertResult.count === 0) {
      return false
    }

    wasInserted = true
  } catch (error) {
    logCustomErrorMessageAndError(`Error inserting handled stripe event, eventId - ${eventId}`, error)
    return false
  }

  try {
    await processingFunction()
    return true
  } catch (error) {
    if (wasInserted) {
      try {
        await sql`
          DELETE FROM handled_stripe_events
          WHERE event_id = ${eventId}
        `
      } catch (deletionError) {
        logCustomErrorMessageAndError(
          `Error rolling back handled stripe event insert, eventId - ${eventId}`,
          deletionError
        )
      }
    }
    logCustomErrorMessageAndError(`Error processing stripe event, eventId - ${eventId}`, error)
    return false
  }
}

export const __deleteAllHandledStripeEvents = async () => {
  await sql`DELETE FROM handled_stripe_events`
}
