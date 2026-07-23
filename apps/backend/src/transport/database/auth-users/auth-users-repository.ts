import { sql } from '../postgres-client'
import { Tables } from '../database.auth.types'

type AuthUser = Tables<{ schema: 'auth' }, 'users'>

export interface AuthUsersRepository {
  removeUserFromAuthUsers: (userId: string) => Promise<boolean>
  findUserById: (id: string) => Promise<AuthUser | null>
  getJoinedDay: (id: string) => Promise<string | null>
}

export const buildAuthUsersRepository = (): AuthUsersRepository => {
  const removeUserFromAuthUsers = async (userId: string): Promise<boolean> => {
    const result = await sql`
      DELETE FROM auth.users
      WHERE id = ${userId}
    `
    return result.count === 1
  }

  const findUserById = async (id: string): Promise<AuthUser | null> => {
    const result = await sql<AuthUser[]>`
      SELECT id, email
      FROM auth.users
      WHERE id = ${id}
    `

    if (result.count === 0) {
      return null
    }

    return result[0]
  }

  // Signup day as a server-UTC 'YYYY-MM-DD' string (never a Date — the stats
  // service compares day strings lexically). auth.users is the source because
  // the public.users row is only created lazily on the first putUser.
  // created_at is schema-nullable, hence the CURRENT_DATE fallback; null means
  // the auth row itself is missing.
  const getJoinedDay = async (id: string): Promise<string | null> => {
    const result = (await sql`
      SELECT COALESCE(created_at::date, CURRENT_DATE)::text AS joined_day
      FROM auth.users
      WHERE id = ${id}
    `) as unknown as Array<{ joined_day: string }>
    return result[0]?.joined_day ?? null
  }

  return {
    removeUserFromAuthUsers,
    findUserById,
    getJoinedDay,
  }
}
