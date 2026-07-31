import { describe, expect, test } from 'vitest'
import { buildAuthUsersRepository } from './auth-users-repository'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'
import { sql } from '../postgres-client'
import { UsersRepository } from '../users/users-repository'

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

  test('deleteStaleAnonymousUsers removes only stale anonymous accounts, cascading app data', async () => {
    const repo = buildAuthUsersRepository()
    const usersRepository = UsersRepository()
    const staleGuest = await __createUserInSupabaseAndGetHisIdAndToken()
    const freshGuest = await __createUserInSupabaseAndGetHisIdAndToken()
    const staleConverted = await __createUserInSupabaseAndGetHisIdAndToken()
    // The admin API can't mint anonymous or backdated accounts, so the
    // fixtures get their is_anonymous flag and age set directly. Only this
    // test creates is_anonymous rows old enough to be swept, so concurrent
    // test files can't lose rows to this DELETE.
    await sql`
      UPDATE auth.users SET is_anonymous = TRUE, created_at = NOW() - interval '40 days'
      WHERE id = ${staleGuest.id}
    `
    await sql`UPDATE auth.users SET is_anonymous = TRUE WHERE id = ${freshGuest.id}`
    await sql`UPDATE auth.users SET created_at = NOW() - interval '40 days' WHERE id = ${staleConverted.id}`
    await usersRepository.insertUser(staleGuest.id, null, {
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    })

    const deletedCount = await repo.deleteStaleAnonymousUsers(30)

    // ≥ 1, not === 1: stale guests left behind by runs older than the
    // retention window are legitimately swept along with our fixture.
    expect(deletedCount).toBeGreaterThanOrEqual(1)
    expect(await repo.findUserById(staleGuest.id)).toBeNull()
    expect(await repo.findUserById(freshGuest.id)).not.toBeNull()
    expect(await repo.findUserById(staleConverted.id)).not.toBeNull()
    // The public.users row goes with the auth row (ON DELETE CASCADE).
    expect(await usersRepository.findUserByUserId(staleGuest.id)).toBeNull()
  })
})
