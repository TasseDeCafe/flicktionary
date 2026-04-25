import { sql } from '../postgres-client'
import { logCustomErrorMessageAndError } from '../../third-party/sentry/error-monitoring'
import { Tables } from '../database.auth.types'

type AuthUser = Tables<{ schema: 'auth' }, 'users'>

export const __getAllAuthUsers = async (): Promise<AuthUser[]> => {
  try {
    const result = await sql<AuthUser[]>`
      SELECT id, email
      FROM auth.users
      ORDER BY email
    `
    return result
  } catch (e) {
    logCustomErrorMessageAndError('getAllAuthUsers', e)
    return []
  }
}

export interface AuthUsersRepository {
  removeUserFromAuthUsers: (userId: string) => Promise<boolean>
  findUserById: (id: string) => Promise<AuthUser | null>
}

export const buildAuthUsersRepository = (): AuthUsersRepository => {
  const removeUserFromAuthUsers = async (userId: string): Promise<boolean> => {
    try {
      const result = await sql`
      DELETE FROM auth.users
      WHERE id = ${userId}
    `
      return result.count === 1
    } catch (e) {
      logCustomErrorMessageAndError(`removeUserFromAuthUsers, userId - ${userId}`, e)
      return false
    }
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
