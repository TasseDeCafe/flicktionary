import { sql, beginTx } from '../postgres-client'

export const handleEventIdempotently = async (
  eventId: string,
  processingFunction: () => Promise<void>
): Promise<boolean> => {
  const insertResult = await beginTx(async (tx) => {
    return tx`
      INSERT INTO handled_stripe_events (event_id)
      VALUES (${eventId})
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id
    `
  })

  if (!insertResult || insertResult.count === 0) {
    return false
  }

  try {
    await processingFunction()
    return true
  } catch (error) {
    // Roll back the idempotency insert so a retry can re-process the event.
    // If the rollback itself fails we surface that — the original error is the
    // caller's primary concern but a stuck idempotency row would cause silent
    // event drops on retry, so let it bubble.
    await sql`
      DELETE FROM handled_stripe_events
      WHERE event_id = ${eventId}
    `
    throw error
  }
}
