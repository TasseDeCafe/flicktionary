import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { getConfig } from '../../../config/environment-config'
import {
  __createUserInSupabaseAndGetHisIdAndToken,
  __removeAllAuthUsersFromSupabase,
  buildTestApp,
} from '../../../test/test-utils'
import { MockRevenuecatApi, RevenuecatApi } from '../../../transport/third-party/revenuecat/revenuecat-api'
import { __getRevenuecatSubscriptionsByUserId } from '../../../transport/database/revenuecat-subscriptions/revenuecat-subscriptions-repository'
import { __deleteAllHandledRevenuecatEvents } from '../../../transport/database/webhook-events/handled-revenuecat-events-repository'

const createMockRevenuecatApiWithCallTracking = (userId: string): RevenuecatApi => ({
  ...MockRevenuecatApi,
  getSubscriptions: async () => {
    const response = await MockRevenuecatApi.getSubscriptions(userId)
    if (response?.items?.[0]) {
      response.items[0].customer_id = userId
    }
    return response
  },
})

const createTestEvent = (userId: string, eventId = 'test_event_id') => ({
  event: {
    id: eventId,
    type: 'SUBSCRIPTION_STATUS_UPDATED',
    app_user_id: userId,
  },
})

describe('revenuecat-webhooks-router', () => {
  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledRevenuecatEvents()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledRevenuecatEvents()
  })

  describe('Authentication', () => {
    it('should return 401 when auth header is missing', async () => {
      const testApp = buildTestApp()
      const response = await request(testApp)
        .post('/api/v1/payment/revenuecat-webhook')
        .send(createTestEvent('some_user_id'))

      expect(response.status).toBe(401)
    })

    it('should return 401 when auth header is invalid', async () => {
      const testApp = buildTestApp()
      const response = await request(testApp)
        .post('/api/v1/payment/revenuecat-webhook')
        .set('Authorization', 'invalid_header')
        .send(createTestEvent('some_user_id'))

      expect(response.status).toBe(401)
    })

    it('should accept request with valid auth header', async () => {
      const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
      const testApp = buildTestApp()
      const response = await request(testApp)
        .post('/api/v1/payment/revenuecat-webhook')
        .set('Authorization', getConfig().revenuecatWebhookAuthHeader)
        .send(createTestEvent(userId))

      expect(response.status).toBe(200)
    })
  })

  describe('Subscription Handling', () => {
    it('should sync subscription data when receiving a valid event', async () => {
      const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
      const revenuecatApi = createMockRevenuecatApiWithCallTracking(userId)
      const testApp = buildTestApp({ revenuecatApi })

      const response = await request(testApp)
        .post('/api/v1/payment/revenuecat-webhook')
        .set('Authorization', getConfig().revenuecatWebhookAuthHeader)
        .send(createTestEvent(userId))

      expect(response.status).toBe(200)

      const subscriptions = await __getRevenuecatSubscriptionsByUserId(userId)
      expect(subscriptions).toHaveLength(1)
      expect(subscriptions[0].user_id).toBe(userId)
      expect(subscriptions[0].revenuecat_product_id).toBe('prod_mock_123')
      expect(subscriptions[0].gives_access).toBe(true)
      expect(subscriptions[0].status).toBe('active')
    })

    it('should ignore TEST events', async () => {
      const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
      const revenuecatApi = createMockRevenuecatApiWithCallTracking(userId)
      const testApp = buildTestApp({ revenuecatApi })

      const testEvent = createTestEvent(userId)
      testEvent.event.type = 'TEST'

      const response = await request(testApp)
        .post('/api/v1/payment/revenuecat-webhook')
        .set('Authorization', getConfig().revenuecatWebhookAuthHeader)
        .send(testEvent)

      expect(response.status).toBe(200)

      const subscriptions = await __getRevenuecatSubscriptionsByUserId(userId)
      expect(subscriptions).toHaveLength(0)
    })

    it('should handle API errors gracefully', async () => {
      const revenuecatApi: RevenuecatApi = {
        ...MockRevenuecatApi,
        getSubscriptions: async () => {
          throw new Error('API Error')
        },
      }
      const testApp = buildTestApp({ revenuecatApi })

      const response = await request(testApp)
        .post('/api/v1/payment/revenuecat-webhook')
        .set('Authorization', getConfig().revenuecatWebhookAuthHeader)
        .send(createTestEvent('some_user_id'))

      expect(response.status).toBe(400)
    })
  })

  describe('Idempotency', () => {
    it('should process the same event only once', async () => {
      const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
      let apiCallCount = 0
      const revenuecatApi: RevenuecatApi = {
        ...MockRevenuecatApi,
        getSubscriptions: async () => {
          apiCallCount++
          const response = await MockRevenuecatApi.getSubscriptions(userId)
          if (response?.items?.[0]) {
            response.items[0].customer_id = userId
          }
          return response
        },
      }
      const testApp = buildTestApp({ revenuecatApi })
      const event = createTestEvent(userId, 'duplicate_event_id')

      const response1 = await request(testApp)
        .post('/api/v1/payment/revenuecat-webhook')
        .set('Authorization', getConfig().revenuecatWebhookAuthHeader)
        .send(event)

      const response2 = await request(testApp)
        .post('/api/v1/payment/revenuecat-webhook')
        .set('Authorization', getConfig().revenuecatWebhookAuthHeader)
        .send(event)

      expect(response1.status).toBe(200)
      expect(response2.status).toBe(200)
      expect(apiCallCount).toBe(1)

      const subscriptions = await __getRevenuecatSubscriptionsByUserId(userId)
      expect(subscriptions).toHaveLength(1)
    })

    it('should process the same event only once when sent in parallel', async () => {
      const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
      let apiCallCount = 0
      const revenuecatApi: RevenuecatApi = {
        ...MockRevenuecatApi,
        getSubscriptions: async () => {
          apiCallCount++
          const response = await MockRevenuecatApi.getSubscriptions(userId)
          if (response?.items?.[0]) {
            response.items[0].customer_id = userId
          }
          return response
        },
      }
      const testApp = buildTestApp({ revenuecatApi })
      const event = createTestEvent(userId, 'parallel_event_id')

      const [response1, response2] = await Promise.all([
        request(testApp)
          .post('/api/v1/payment/revenuecat-webhook')
          .set('Authorization', getConfig().revenuecatWebhookAuthHeader)
          .send(event),
        request(testApp)
          .post('/api/v1/payment/revenuecat-webhook')
          .set('Authorization', getConfig().revenuecatWebhookAuthHeader)
          .send(event),
      ])

      expect(response1.status).toBe(200)
      expect(response2.status).toBe(200)
      expect(apiCallCount).toBe(1)

      const subscriptions = await __getRevenuecatSubscriptionsByUserId(userId)
      expect(subscriptions).toHaveLength(1)
    })
  })
})
