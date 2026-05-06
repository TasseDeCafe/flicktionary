import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbPracticeSession = Tables<'practice_sessions'>
export type PracticeSessionStatus = Database['public']['Enums']['practice_session_status']

const insert = async (params: { userId: string; targetLanguage: string }): Promise<DbPracticeSession> => {
  const result = (await sql`
    INSERT INTO public.practice_sessions (user_id, target_language)
    VALUES (${params.userId}, ${params.targetLanguage})
    RETURNING *
  `) as DbPracticeSession[]
  return result[0]!
}

const findByIdForUser = async (id: string, userId: string): Promise<DbPracticeSession | null> => {
  const result = (await sql`
    SELECT *
    FROM public.practice_sessions
    WHERE id = ${id} AND user_id = ${userId}
  `) as DbPracticeSession[]
  return result[0] ?? null
}

const listRecentByUser = async (userId: string, limit = 20): Promise<DbPracticeSession[]> => {
  return (await sql`
    SELECT *
    FROM public.practice_sessions
    WHERE user_id = ${userId}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `) as DbPracticeSession[]
}

const markCompleted = async (id: string, userId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.practice_sessions
    SET status = 'completed', ended_at = NOW()
    WHERE id = ${id} AND user_id = ${userId} AND status = 'active'
  `
  return result.count > 0
}

const markAbandoned = async (id: string, userId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.practice_sessions
    SET status = 'abandoned', ended_at = NOW()
    WHERE id = ${id} AND user_id = ${userId} AND status = 'active'
  `
  return result.count > 0
}

export interface PracticeSessionsRepositoryInterface {
  insert: (params: { userId: string; targetLanguage: string }) => Promise<DbPracticeSession>
  findByIdForUser: (id: string, userId: string) => Promise<DbPracticeSession | null>
  listRecentByUser: (userId: string, limit?: number) => Promise<DbPracticeSession[]>
  markCompleted: (id: string, userId: string) => Promise<boolean>
  markAbandoned: (id: string, userId: string) => Promise<boolean>
}

export const PracticeSessionsRepository = (): PracticeSessionsRepositoryInterface => {
  return {
    insert,
    findByIdForUser,
    listRecentByUser,
    markCompleted,
    markAbandoned,
  }
}
