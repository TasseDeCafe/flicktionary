import { describe, expect, test } from 'vitest'
import { buildAuthUsersRepository } from './auth-users-repository'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'
import { sql } from '../postgres-client'

describe('auth-users repository', () => {
  test('joined day is the auth creation date as a YYYY-MM-DD string', async () => {
    const { id } = await __createUserInSupabaseAndGetHisIdAndToken()
    const joined = await buildAuthUsersRepository().getJoinedDay(id)
    expect(joined).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The account was just created, so its joined day is the server's today.
    const rows = (await sql`SELECT CURRENT_DATE::text AS today`) as Array<{ today: string }>
    expect(joined).toBe(rows[0].today)
  })

  test('an unknown id returns null', async () => {
    const joined = await buildAuthUsersRepository().getJoinedDay('00000000-0000-0000-0000-000000000000')
    expect(joined).toBeNull()
  })
})
