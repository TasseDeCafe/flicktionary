import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __removeAllAuthUsersFromSupabase,
  buildTestApp,
} from '../../test/test-utils'
import { __deleteAllHandledStripeEvents } from '../../transport/database/webhook-events/handled-stripe-events-repository'

describe('users-router', async () => {
  const testApp = buildTestApp()

  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  test('when user is unauthenticated', async () => {
    const createResponse = await request(testApp).put('/api/v1/users/me').set({ Authorization: `Bearer wrong-token` })

    expect(createResponse.status).toBe(401)
  })

  test('create and find user', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    const createResponse = await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    expect(createResponse.status).toBe(200)

    const { status, body } = await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    expect(status).toBe(200)
    expect(body.data).toEqual({
      referral: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    })
  })

  test('create and find user with referral', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    const createResponse = await __createOrGetUserWithOurApi({ testApp, token, referral: 'tiengos' })
    expect(createResponse.status).toBe(200)

    const { status, body } = await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    expect(status).toBe(200)
    expect(body.data).toEqual({
      referral: 'tiengos',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    })
  })

  describe('UTM parameters', () => {
    test('should save UTM parameters on first user creation', async () => {
      const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
      const utmParams = {
        utmSource: 'facebook',
        utmMedium: 'cpc',
        utmCampaign: 'summer_sale',
        utmTerm: 'language_learning',
        utmContent: 'top_banner',
      }

      // First create user with UTM params
      const response = await __createOrGetUserWithOurApi({
        testApp,
        token,
        referral: null,
        ...utmParams,
      })

      expect(response.status).toBe(200)
      expect(response.body.data.utmSource).toBe(utmParams.utmSource)
      expect(response.body.data.utmMedium).toBe(utmParams.utmMedium)
      expect(response.body.data.utmCampaign).toBe(utmParams.utmCampaign)
      expect(response.body.data.utmTerm).toBe(utmParams.utmTerm)
      expect(response.body.data.utmContent).toBe(utmParams.utmContent)
    })

    test('should preserve UTM parameters on subsequent calls', async () => {
      const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
      const initialUtmParams = {
        utmSource: 'facebook',
        utmMedium: 'cpc',
        utmCampaign: 'summer_sale',
        utmTerm: 'language_learning',
        utmContent: 'top_banner',
      }

      // First create user with initial UTM params
      await __createOrGetUserWithOurApi({
        testApp,
        token,
        referral: null,
        ...initialUtmParams,
      })

      // Try to update with different UTM params
      const newUtmParams = {
        utmSource: 'google',
        utmMedium: 'organic',
        utmCampaign: 'winter_sale',
        utmTerm: 'english_learning',
        utmContent: 'bottom_banner',
      }

      const response = await __createOrGetUserWithOurApi({
        testApp,
        token,
        referral: null,
        ...newUtmParams,
      })

      // Verify that the original UTM params are preserved
      expect(response.status).toBe(200)
      expect(response.body.data.utmSource).toBe(initialUtmParams.utmSource)
      expect(response.body.data.utmMedium).toBe(initialUtmParams.utmMedium)
      expect(response.body.data.utmCampaign).toBe(initialUtmParams.utmCampaign)
      expect(response.body.data.utmTerm).toBe(initialUtmParams.utmTerm)
      expect(response.body.data.utmContent).toBe(initialUtmParams.utmContent)
    })

    test('should handle null UTM parameters correctly', async () => {
      const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
      const initialUtmParams = {
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
      }

      // First create user with null UTM params
      const createResponse = await __createOrGetUserWithOurApi({
        testApp,
        token,
        referral: null,
        ...initialUtmParams,
      })

      expect(createResponse.status).toBe(200)
      expect(createResponse.body.data.utmSource).toBeNull()
      expect(createResponse.body.data.utmMedium).toBeNull()
      expect(createResponse.body.data.utmCampaign).toBeNull()
      expect(createResponse.body.data.utmTerm).toBeNull()
      expect(createResponse.body.data.utmContent).toBeNull()

      // Try to update with non-null UTM params
      const newUtmParams = {
        utmSource: 'google',
        utmMedium: 'organic',
        utmCampaign: 'winter_sale',
        utmTerm: 'english_learning',
        utmContent: 'bottom_banner',
      }

      const updateResponse = await __createOrGetUserWithOurApi({
        testApp,
        token,
        referral: null,
        ...newUtmParams,
      })

      // Verify that the null UTM params are preserved
      expect(updateResponse.status).toBe(200)
      expect(updateResponse.body.data.utmSource).toBeNull()
      expect(updateResponse.body.data.utmMedium).toBeNull()
      expect(updateResponse.body.data.utmCampaign).toBeNull()
      expect(updateResponse.body.data.utmTerm).toBeNull()
      expect(updateResponse.body.data.utmContent).toBeNull()
    })
  })
})
