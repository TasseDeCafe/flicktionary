import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type __DbRemoval = Tables<'removals'>

export const insertRemoval = async (userId: string, email: string | null, wasSuccessful: boolean): Promise<string> => {
  const result = await sql`
    INSERT INTO public.removals (user_id, email, was_successful)
    VALUES (${userId}, ${email}, ${wasSuccessful})
    RETURNING id
  `
  return result[0].id as string
}

export const updateRemovalSuccess = async (removalId: string, wasSuccessful: boolean): Promise<boolean> => {
  const result = await sql`
    UPDATE public.removals
    SET was_successful = ${wasSuccessful}
    WHERE id = ${removalId}
  `
  return result.count === 1
}

export const __selectAllRemovals = async (): Promise<__DbRemoval[]> => {
  return (await sql`
    SELECT * FROM public.removals
    ORDER BY created_at DESC
  `) as __DbRemoval[]
}
