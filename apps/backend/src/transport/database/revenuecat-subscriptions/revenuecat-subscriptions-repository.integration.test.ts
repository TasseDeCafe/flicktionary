import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __removeAllAuthUsersFromSupabase } from '../../../test/test-utils'
import {
  __getRevenuecatSubscriptionsByUserId,
  DbRevenuecatSubscriptionInput,
  RevenuecatSubscriptionsRepository,
} from './revenuecat-subscriptions-repository'

describe('RevenueCat Subscriptions Repository Integration Tests', () => {
  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  afterEach(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  const createTestSubscription = (userId: string, overrides = {}): DbRevenuecatSubscriptionInput => ({
    user_id: userId,
    revenuecat_subscription_id: 'test-sub-id',
    revenuecat_original_customer_id: 'test-customer-id',
    revenuecat_product_id: 'test-product-id',
    starts_at: new Date().toISOString(),
    current_period_starts_at: new Date().toISOString(),
    current_period_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    gives_access: true,
    pending_payment: false,
    auto_renewal_status: 'will_renew',
    status: 'active',
    total_revenue_in_usd: 19.99,
    presented_offering_id: 'default',
    environment: 'production',
    store: 'app_store',
    store_subscription_identifier: 'store-sub-id',
    ownership_type: 'purchased',
    billing_country_code: 'US',
    management_url: 'https://example.com/manage',
    updated_at: new Date().toISOString(),
    ...overrides,
  })

  const repository = RevenuecatSubscriptionsRepository()

  describe('upsertSubscription', () => {
    const repository = RevenuecatSubscriptionsRepository()

    it('should insert a new subscription successfully', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()
      const testSubscription = createTestSubscription(testUserId)

      const result = await repository.upsertSubscription(testSubscription)
      expect(result).toBe(true)

      const subscriptions = await __getRevenuecatSubscriptionsByUserId(testUserId)
      expect(subscriptions).toHaveLength(1)

      const subscription = subscriptions[0]
      expect(subscription.user_id).toBe(testUserId)
      expect(subscription.revenuecat_subscription_id).toBe(testSubscription.revenuecat_subscription_id)
      expect(subscription.revenuecat_product_id).toBe(testSubscription.revenuecat_product_id)
      expect(subscription.gives_access).toBe(true)
      expect(subscription.status).toBe('active')
    })

    it('should update an existing subscription', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()
      const originalSubscription = createTestSubscription(testUserId)

      await repository.upsertSubscription(originalSubscription)

      const updatedSubscription: DbRevenuecatSubscriptionInput = {
        ...originalSubscription,
        status: 'expired',
        gives_access: false,
        auto_renewal_status: 'will_not_renew',
        total_revenue_in_usd: 39.98,
        current_period_ends_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }
      const updateResult = await repository.upsertSubscription(updatedSubscription)
      expect(updateResult).toBe(true)

      const subscriptions = await __getRevenuecatSubscriptionsByUserId(testUserId)
      expect(subscriptions).toHaveLength(1)

      const subscription = subscriptions[0]
      expect(subscription.revenuecat_subscription_id).toBe(originalSubscription.revenuecat_subscription_id)
      expect(subscription.status).toBe('expired')
      expect(subscription.gives_access).toBe(false)
      expect(subscription.auto_renewal_status).toBe('will_not_renew')
      expect(subscription.total_revenue_in_usd).toBe('39.98')
      expect(new Date(subscription.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(subscription.created_at).getTime()
      )
    })

    it('should handle null values correctly', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()
      const testSubscription = createTestSubscription(testUserId, {
        current_period_ends_at: null,
        revenuecat_product_id: null,
        presented_offering_id: null,
        billing_country_code: null,
        management_url: null,
      })

      const result = await repository.upsertSubscription(testSubscription)
      expect(result).toBe(true)

      const subscriptions = await __getRevenuecatSubscriptionsByUserId(testUserId)
      expect(subscriptions).toHaveLength(1)

      const subscription = subscriptions[0]
      expect(subscription.current_period_ends_at).toBeNull()
      expect(subscription.revenuecat_product_id).toBeNull()
      expect(subscription.presented_offering_id).toBeNull()
      expect(subscription.billing_country_code).toBeNull()
      expect(subscription.management_url).toBeNull()
    })
  })

  describe('getActiveSubscriptionsByUserId', () => {
    it('should return only active subscriptions', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      const activeSubscription = createTestSubscription(testUserId)
      await repository.upsertSubscription(activeSubscription)

      const inactiveSubscription = createTestSubscription(testUserId, {
        revenuecat_subscription_id: 'test-sub-id-2',
        gives_access: false,
        status: 'expired',
      })
      await repository.upsertSubscription(inactiveSubscription)

      const activeSubscriptions = await repository.getActiveSubscriptionsByUserId(testUserId)
      expect(activeSubscriptions).toHaveLength(1)
      expect(activeSubscriptions[0].gives_access).toBe(true)
      expect(activeSubscriptions[0].revenuecat_subscription_id).toBe('test-sub-id')
    })

    it('should return empty array for user with no active subscriptions', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      const inactiveSubscription = createTestSubscription(testUserId, {
        gives_access: false,
        status: 'expired',
      })
      await repository.upsertSubscription(inactiveSubscription)

      const activeSubscriptions = await repository.getActiveSubscriptionsByUserId(testUserId)
      expect(activeSubscriptions).toHaveLength(0)
    })

    it('should return active subscriptions ordered by created_at DESC', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      const olderSubscription = createTestSubscription(testUserId, {
        revenuecat_subscription_id: 'test-sub-id-1',
      })
      await repository.upsertSubscription(olderSubscription)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const newerSubscription = createTestSubscription(testUserId, {
        revenuecat_subscription_id: 'test-sub-id-2',
      })
      await repository.upsertSubscription(newerSubscription)

      const activeSubscriptions = await repository.getActiveSubscriptionsByUserId(testUserId)
      expect(activeSubscriptions).toHaveLength(2)
      expect(activeSubscriptions[0].revenuecat_subscription_id).toBe('test-sub-id-2')
      expect(activeSubscriptions[1].revenuecat_subscription_id).toBe('test-sub-id-1')
    })
  })

  describe('getRevenuecatSubscriptionsByUserId', () => {
    it('should return all subscriptions for a user', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      const subscription1 = createTestSubscription(testUserId)
      const subscription2 = createTestSubscription(testUserId, {
        revenuecat_subscription_id: 'test-sub-id-2',
        status: 'expired',
        gives_access: false,
      })

      await repository.upsertSubscription(subscription1)
      await repository.upsertSubscription(subscription2)

      const subscriptions = await __getRevenuecatSubscriptionsByUserId(testUserId)
      expect(subscriptions).toHaveLength(2)
      expect(subscriptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ revenuecat_subscription_id: 'test-sub-id' }),
          expect.objectContaining({ revenuecat_subscription_id: 'test-sub-id-2' }),
        ])
      )
    })

    it('should return empty array for user with no subscriptions', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()
      const subscriptions = await __getRevenuecatSubscriptionsByUserId(testUserId)
      expect(subscriptions).toHaveLength(0)
    })

    it('should return subscriptions ordered by created_at DESC', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      const olderSubscription = createTestSubscription(testUserId, {
        revenuecat_subscription_id: 'test-sub-id-1',
      })
      await repository.upsertSubscription(olderSubscription)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const newerSubscription = createTestSubscription(testUserId, {
        revenuecat_subscription_id: 'test-sub-id-2',
      })
      await repository.upsertSubscription(newerSubscription)

      const subscriptions = await __getRevenuecatSubscriptionsByUserId(testUserId)
      expect(subscriptions).toHaveLength(2)
      expect(subscriptions[0].revenuecat_subscription_id).toBe('test-sub-id-2')
      expect(subscriptions[1].revenuecat_subscription_id).toBe('test-sub-id-1')
    })
  })

  describe('getAllActiveSubscriptions', () => {
    it('should return all active subscriptions across multiple users', async () => {
      // Create two test users
      const { id: user1Id } = await __createUserInSupabaseAndGetHisIdAndToken('user1@email.com')
      const { id: user2Id } = await __createUserInSupabaseAndGetHisIdAndToken('user2@email.com')

      const activeSubscription1 = createTestSubscription(user1Id, {
        revenuecat_subscription_id: 'test-sub-id-1',
        gives_access: true,
      })
      const activeSubscription2 = createTestSubscription(user2Id, {
        revenuecat_subscription_id: 'test-sub-id-2',
        gives_access: true,
      })

      const inactiveSubscription1 = createTestSubscription(user1Id, {
        revenuecat_subscription_id: 'test-sub-id-3',
        gives_access: false,
        status: 'expired',
      })
      const inactiveSubscription2 = createTestSubscription(user2Id, {
        revenuecat_subscription_id: 'test-sub-id-4',
        gives_access: false,
        status: 'expired',
      })

      await repository.upsertSubscription(activeSubscription1)
      await repository.upsertSubscription(activeSubscription2)
      await repository.upsertSubscription(inactiveSubscription1)
      await repository.upsertSubscription(inactiveSubscription2)

      const activeSubscriptions = await repository.getAllActiveSubscriptions()

      expect(activeSubscriptions).toHaveLength(2)
      expect(activeSubscriptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            revenuecat_subscription_id: 'test-sub-id-1',
            gives_access: true,
            user_id: user1Id,
          }),
          expect.objectContaining({
            revenuecat_subscription_id: 'test-sub-id-2',
            gives_access: true,
            user_id: user2Id,
          }),
        ])
      )
    })

    it('should return empty array when no active subscriptions exist', async () => {
      const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()

      const inactiveSubscription = createTestSubscription(userId, {
        gives_access: false,
        status: 'expired',
      })
      await repository.upsertSubscription(inactiveSubscription)

      const activeSubscriptions = await repository.getAllActiveSubscriptions()
      expect(activeSubscriptions).toHaveLength(0)
    })

    it('should return subscriptions ordered by created_at DESC', async () => {
      const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()

      const olderSubscription = createTestSubscription(userId, {
        revenuecat_subscription_id: 'test-sub-id-1',
        gives_access: true,
      })
      await repository.upsertSubscription(olderSubscription)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const newerSubscription = createTestSubscription(userId, {
        revenuecat_subscription_id: 'test-sub-id-2',
        gives_access: true,
      })
      await repository.upsertSubscription(newerSubscription)

      const activeSubscriptions = await repository.getAllActiveSubscriptions()
      expect(activeSubscriptions).toHaveLength(2)
      expect(activeSubscriptions[0].revenuecat_subscription_id).toBe('test-sub-id-2')
      expect(activeSubscriptions[1].revenuecat_subscription_id).toBe('test-sub-id-1')
    })

    it('should handle multiple subscriptions per user correctly', async () => {
      const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()

      const subscription1 = createTestSubscription(userId, {
        revenuecat_subscription_id: 'test-sub-id-1',
        gives_access: true,
      })
      const subscription2 = createTestSubscription(userId, {
        revenuecat_subscription_id: 'test-sub-id-2',
        gives_access: true,
      })
      const inactiveSubscription = createTestSubscription(userId, {
        revenuecat_subscription_id: 'test-sub-id-3',
        gives_access: false,
      })

      await repository.upsertSubscription(subscription1)
      await repository.upsertSubscription(subscription2)
      await repository.upsertSubscription(inactiveSubscription)

      const activeSubscriptions = await repository.getAllActiveSubscriptions()
      expect(activeSubscriptions).toHaveLength(2)
      expect(activeSubscriptions.every((sub) => sub.user_id === userId)).toBe(true)
      expect(activeSubscriptions.every((sub) => sub.gives_access)).toBe(true)
    })
  })
})
