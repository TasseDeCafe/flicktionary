import { describe, expect, test } from 'vitest'
import { UsersRepository } from './users-repository'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'
import { sql } from '../postgres-client'

describe('users-repository integration tests', () => {
  const {
    findUserByStripeCustomerId,
    findUserByUserId,
    insertUser,
    updateStripeCustomerId,
    retrieveAllUsersCreatedLessThanNDaysAgo,
    getAccountFlags,
    addAccountFlag,
  } = UsersRepository()
  const emptyUtmParams = {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
  }

  test('should update stripe customer id', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const stripeCustomerId = __generateUniqueId('cus')

    await insertUser(userId, null, emptyUtmParams)
    const result = await updateStripeCustomerId(userId, stripeCustomerId)

    expect(result).toBe(true)

    const user = await findUserByUserId(userId)
    expect(user?.stripe_customer_id).toBe(stripeCustomerId)
  })

  test('should set stripe customer id to null', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const stripeCustomerId = __generateUniqueId('cus')

    await insertUser(userId, null, emptyUtmParams)
    await updateStripeCustomerId(userId, stripeCustomerId)
    const result = await updateStripeCustomerId(userId, null)

    expect(result).toBe(true)

    const user = await findUserByUserId(userId)
    expect(user?.stripe_customer_id).toBeNull()
  })

  test('should find user by stripe customer id', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const stripeCustomerId = __generateUniqueId('cus')

    await insertUser(userId, null, emptyUtmParams)
    await updateStripeCustomerId(userId, stripeCustomerId)

    const user = await findUserByStripeCustomerId(stripeCustomerId)

    expect(user).not.toBeNull()
    expect(user?.id).toBe(userId)
    expect(user?.stripe_customer_id).toBe(stripeCustomerId)
  })

  test('should store UTM parameters when creating a new user', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const utmParams = {
      utmSource: 'test_source',
      utmMedium: 'test_medium',
      utmCampaign: 'test_campaign',
      utmTerm: 'test_term',
      utmContent: 'test_content',
    }

    await insertUser(userId, null, utmParams)
    const user = await findUserByUserId(userId)

    expect(user).not.toBeNull()
    expect(user?.utm_source).toBe(utmParams.utmSource)
    expect(user?.utm_medium).toBe(utmParams.utmMedium)
    expect(user?.utm_campaign).toBe(utmParams.utmCampaign)
    expect(user?.utm_term).toBe(utmParams.utmTerm)
    expect(user?.utm_content).toBe(utmParams.utmContent)
  })

  test('should handle null UTM parameters when creating a new user', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const utmParams = {
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    }

    await insertUser(userId, null, utmParams)
    const user = await findUserByUserId(userId)

    expect(user).not.toBeNull()
    expect(user?.utm_source).toBeNull()
    expect(user?.utm_medium).toBeNull()
    expect(user?.utm_campaign).toBeNull()
    expect(user?.utm_term).toBeNull()
    expect(user?.utm_content).toBeNull()
  })

  test('should return null when finding non-existent stripe customer id', async () => {
    const user = await findUserByStripeCustomerId('non-existent-stripe-customer-id')
    expect(user).toBeNull()
  })

  test('should return false when updating stripe customer id for non-existent user', async () => {
    const result = await updateStripeCustomerId('00000000-0000-4000-a000-000000000099', __generateUniqueId('cus'))
    expect(result).toBe(false)
  })

  describe('account flags', () => {
    test('default to an empty array and append idempotently in insertion order', async () => {
      const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
      await insertUser(userId, null, emptyUtmParams)

      expect(await getAccountFlags(userId)).toEqual([])

      expect(await addAccountFlag(userId, 'getting_started_dismissed')).toBe(true)
      expect(await addAccountFlag(userId, 'extension_installed')).toBe(true)
      // Re-adding a present flag succeeds without duplicating it.
      expect(await addAccountFlag(userId, 'getting_started_dismissed')).toBe(true)

      expect(await getAccountFlags(userId)).toEqual(['getting_started_dismissed', 'extension_installed'])
    })

    test('report a missing user as empty flags / failed add', async () => {
      const missingUserId = '00000000-0000-4000-a000-000000000098'
      expect(await getAccountFlags(missingUserId)).toEqual([])
      expect(await addAccountFlag(missingUserId, 'extension_installed')).toBe(false)
    })
  })

  describe('retrieveAllUsersCreatedLessThanNDaysAgo', () => {
    // The query scans the whole users table, so assert membership of this
    // test's users rather than exact counts (other tests' users are also in
    // the result).
    test('should return users based on their creation date', async () => {
      const { id: userId1 } = await __createUserInSupabaseAndGetHisIdAndToken()
      const { id: userId2 } = await __createUserInSupabaseAndGetHisIdAndToken()

      await insertUser(userId1, null, emptyUtmParams)
      await insertUser(userId2, null, emptyUtmParams)

      // Set creation dates to 29 hours ago
      await sql`
        UPDATE public.users
        SET created_at = NOW() - INTERVAL '29 hours'
        WHERE id IN (${userId1}, ${userId2})
      `

      const usersWithinTwoDays = await retrieveAllUsersCreatedLessThanNDaysAgo(2)
      expect(usersWithinTwoDays).toContain(userId1)
      expect(usersWithinTwoDays).toContain(userId2)

      const usersWithinOneDay = await retrieveAllUsersCreatedLessThanNDaysAgo(1)
      expect(usersWithinOneDay).not.toContain(userId1)
      expect(usersWithinOneDay).not.toContain(userId2)
    })
  })
})
