import { sql } from '../postgres-client'
import { logMessage, logCustomErrorMessageAndError } from '../../third-party/sentry/error-monitoring'
import { Tables } from '../database.public.types'

export type __DbRemoval = Tables<'removals'>

export const insertRemoval = async (userId: string, email: string, wasSuccessful: boolean): Promise<string | null> => {
  try {
    const result = await sql`
      INSERT INTO public.removals (user_id, email, was_successful)
      VALUES (${userId}, ${email}, ${wasSuccessful})
      RETURNING id
    `

    if (result && result.length > 0) {
      return result[0].id as string
    } else {
      logMessage(
        `insertRemoval: Insertion successful, but no id returned, userId = ${userId}, email = ${email}, wasSuccessful = ${wasSuccessful}`
      )
      return null
    }
  } catch (e) {
    logCustomErrorMessageAndError(
      `insertRemoval, userId = ${userId}, email = ${email}, wasSuccessful = ${wasSuccessful}`,
      e
    )
    return null
  }
}

export const updateRemovalSuccess = async (removalId: string, wasSuccessful: boolean): Promise<boolean> => {
  try {
    const result = await sql`
      UPDATE public.removals
      SET was_successful = ${wasSuccessful}
      WHERE id = ${removalId}
    `

    if (result.count === 0) {
      logMessage(`updateRemovalSuccess error, removalId = ${removalId}, wasSuccessful = ${wasSuccessful}`)
      return false
    }

    return true
  } catch (e) {
    logCustomErrorMessageAndError(`updateRemovalSuccess error, removalId = ${removalId}`, e)
    return false
  }
}

export const __selectAllRemovals = async (): Promise<__DbRemoval[]> => {
  try {
    const result = (await sql`
      SELECT * FROM public.removals
      ORDER BY created_at DESC
    `) as __DbRemoval[]
    return result
  } catch (e) {
    throw Error('__selectAllRemovals - error: ' + JSON.stringify(e))
  }
}

export const __deleteRemovals = async () => {
  try {
    await sql`DELETE FROM public.removals`
  } catch (e) {
    throw Error('__deleteRemovals - error: ' + JSON.stringify(e))
  }
}
