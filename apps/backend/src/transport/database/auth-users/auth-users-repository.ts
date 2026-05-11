import { sql } from '../postgres-client'
import { Tables } from '../database.auth.types'

type AuthUser = Tables<{ schema: 'auth' }, 'users'>

export const __getAllAuthUsers = async (): Promise<AuthUser[]> => {
  return await sql<AuthUser[]>`
    SELECT id, email
    FROM auth.users
    ORDER BY email
  `
}

export interface AuthUsersRepository {
  removeUserFromAuthUsers: (userId: string) => Promise<boolean>
  findUserById: (id: string) => Promise<AuthUser | null>
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

  return {
    removeUserFromAuthUsers,
    findUserById,
  }
}
