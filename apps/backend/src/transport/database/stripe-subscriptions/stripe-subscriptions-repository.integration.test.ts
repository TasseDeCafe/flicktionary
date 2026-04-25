import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __removeAllAuthUsersFromSupabase } from '../../../test/test-utils'
import {
  DbStripeSubscription,
  StripeSubscriptionsRepository,
  StripeSubscriptionsRepositoryInterface,
} from './stripe-subscriptions-repository'

describe('Subscription Repository Integration Tests', () => {
  let repository: StripeSubscriptionsRepositoryInterface

  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
    repository = StripeSubscriptionsRepository()
  })

  afterEach(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  describe('insertSubscription', () => {
    it('should insert a subscription successfully', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      const result = await repository.insertSubscription(
        testUserId,
        'test-stripe-subscription-id',
        'active',
        1630000000,
        false,
        1631000000,
        'test-product-id',
        1629000000,
        'eur',
        1917,
        'month',
        1
      )

      expect(result).toBe(true)

      const insertedSubscription =
        await repository.findSubscriptionByStripeSubscriptionId('test-stripe-subscription-id')
      expect(insertedSubscription).not.toBeNull()
      const subscription = insertedSubscription as DbStripeSubscription
      expect(subscription.user_id).toBe(testUserId)
      expect(subscription.stripe_subscription_id).toBe('test-stripe-subscription-id')
      expect(subscription.status).toBe('active')
      expect(subscription.current_period_end).not.toBeNull()
      expect(new Date(subscription.current_period_end!).getTime()).toBe(1630000000 * 1000)
      expect(subscription.cancel_at_period_end).toBe(false)
      expect(subscription.trial_end).not.toBeNull()
      expect(new Date(subscription.trial_end!).getTime()).toBe(1631000000 * 1000)
      expect(subscription.stripe_product_id).toBe('test-product-id')
      expect(subscription.created_at).toBeInstanceOf(Date)
      expect(subscription.updated_at).toBeInstanceOf(Date)
      expect(subscription.amount).toBe('1917.000000')
      expect(subscription.currency).toBe('eur')
      expect(subscription.interval).toBe('month')
      expect(subscription.interval_count).toBe(1)
    })
  })

  describe('upsertSubscription', () => {
    it('should insert a new subscription when it does not exist', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      const result = await repository.upsertSubscription(
        testUserId,
        'test-stripe-subscription-id',
        'active',
        1630000000,
        false,
        1631000000,
        'test-product-id',
        1629000000,
        'eur',
        1900,
        'month',
        1
      )

      expect(result).toBe(true)

      const upsertedSubscription =
        await repository.findSubscriptionByStripeSubscriptionId('test-stripe-subscription-id')
      expect(upsertedSubscription).not.toBeNull()
      const subscription = upsertedSubscription as DbStripeSubscription
      expect(subscription.user_id).toBe(testUserId)
      expect(subscription.stripe_subscription_id).toBe('test-stripe-subscription-id')
      expect(subscription.status).toBe('active')
      expect(subscription.current_period_end).not.toBeNull()
      expect(new Date(subscription.current_period_end!).getTime()).toBe(1630000000 * 1000)
      expect(subscription.cancel_at_period_end).toBe(false)
      expect(subscription.trial_end).not.toBeNull()
      expect(new Date(subscription.trial_end!).getTime()).toBe(1631000000 * 1000)
      expect(subscription.stripe_product_id).toBe('test-product-id')
      expect(subscription.created_at).toBeInstanceOf(Date)
      expect(subscription.updated_at).toBeInstanceOf(Date)
      expect(subscription.amount).toBe('1900.000000')
      expect(subscription.currency).toBe('eur')
      expect(subscription.interval).toBe('month')
      expect(subscription.interval_count).toBe(1)
    })

    it('should update an existing subscription', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      await repository.insertSubscription(
        testUserId,
        'test-stripe-subscription-id',
        'active',
        1630000000,
        false,
        1631000000,
        'test-product-id',
        1629000000,
        'eur',
        1900,
        'month',
        1
      )

      const result = await repository.upsertSubscription(
        testUserId,
        'test-stripe-subscription-id',
        'past_due',
        1640000000,
        true,
        null,
        'new-test-product-id',
        1639000000,
        'eur',
        1900,
        'year',
        2
      )

      expect(result).toBe(true)

      const updatedSubscription = await repository.findSubscriptionByStripeSubscriptionId('test-stripe-subscription-id')
      expect(updatedSubscription).not.toBeNull()
      const subscription = updatedSubscription as DbStripeSubscription
      expect(subscription.user_id).toBe(testUserId)
      expect(subscription.stripe_subscription_id).toBe('test-stripe-subscription-id')
      expect(subscription.status).toBe('past_due')
      expect(subscription.current_period_end).not.toBeNull()
      expect(new Date(subscription.current_period_end!).getTime()).toBe(1640000000 * 1000)
      expect(subscription.cancel_at_period_end).toBe(true)
      expect(subscription.trial_end).toBeNull()
      expect(subscription.stripe_product_id).toBe('new-test-product-id')
      expect(subscription.created_at).toBeInstanceOf(Date)
      expect(subscription.updated_at).toBeInstanceOf(Date)
      // Cast needed: postgres.js returns Date objects, but generated types say string
      expect((subscription.updated_at as unknown as Date).getTime()).toBeGreaterThan(
        (subscription.created_at as unknown as Date).getTime()
      )
      expect(subscription.amount).toBe('1900.000000')
      expect(subscription.currency).toBe('eur')
      expect(subscription.interval).toBe('year')
      expect(subscription.interval_count).toBe(2)
    })
  })

  describe('getSubscriptionUpdatedAt', () => {
    it('should return the updated_at timestamp', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      await repository.insertSubscription(
        testUserId,
        'test-stripe-subscription-id',
        'active',
        1630000000,
        false,
        1631000000,
        'test-product-id',
        1629000000,
        'eur',
        1000,
        'month',
        1
      )

      const updatedAt = await repository.getSubscriptionUpdatedAt('test-stripe-subscription-id')

      expect(updatedAt).not.toBeNull()
      expect(typeof updatedAt).toBe('number')
      expect(updatedAt).toBe(1629000000)
    })

    it('should return null when no subscription is found', async () => {
      const updatedAt = await repository.getSubscriptionUpdatedAt('non-existent-subscription-id')

      expect(updatedAt).toBeNull()
    })
  })

  describe('cancelSubscription', () => {
    it('should cancel an existing subscription', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      await repository.insertSubscription(
        testUserId,
        'test-stripe-subscription-id',
        'active',
        1630000000,
        false,
        1631000000,
        'test-product-id',
        1629000000,
        'eur',
        19,
        'month',
        1
      )

      const cancellationResult = await repository.cancelSubscription('test-stripe-subscription-id')

      expect(cancellationResult).toBe(true)

      const canceledSubscription =
        await repository.findSubscriptionByStripeSubscriptionId('test-stripe-subscription-id')
      expect(canceledSubscription).not.toBeNull()
      const result = canceledSubscription as DbStripeSubscription
      expect(result.status).toBe('canceled')
      // Cast needed: postgres.js returns Date objects, but generated types say string
      expect((result.updated_at as unknown as Date).getTime()).toBeGreaterThan(
        (result.created_at as unknown as Date).getTime()
      )
    })
  })

  describe('getAllSubscriptions', () => {
    it('should return all subscriptions', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      await repository.insertSubscription(
        testUserId,
        'test-stripe-subscription-id',
        'active',
        1630000000,
        false,
        1631000000,
        'test-product-id',
        1629000000,
        'eur',
        1900,
        'month',
        1
      )

      const subscriptions = await repository.getAllSubscriptions()

      expect(subscriptions.length).toBeGreaterThan(0)
      const testSubscription = subscriptions.find((sub) => sub.user_id === testUserId)
      expect(testSubscription).toBeDefined()
      const subscription = testSubscription as DbStripeSubscription
      expect(subscription.stripe_subscription_id).toBe('test-stripe-subscription-id')
      expect(subscription.status).toBe('active')
      expect(subscription.current_period_end).not.toBeNull()
      expect(new Date(subscription.current_period_end!).getTime()).toBe(1630000000 * 1000)
      expect(subscription.cancel_at_period_end).toBe(false)
      expect(subscription.trial_end).not.toBeNull()
      expect(new Date(subscription.trial_end!).getTime()).toBe(1631000000 * 1000)
      expect(subscription.stripe_product_id).toBe('test-product-id')
      expect(subscription.created_at).toBeInstanceOf(Date)
      expect(subscription.updated_at).toBeInstanceOf(Date)
      expect(subscription.amount).toBe('1900.000000')
      expect(subscription.currency).toBe('eur')
      expect(subscription.interval).toBe('month')
      expect(subscription.interval_count).toBe(1)
    })
  })

  describe('getSubscriptionsByUserId', () => {
    it('should return subscriptions for a specific user', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      await repository.insertSubscription(
        testUserId,
        'test-stripe-subscription-id',
        'active',
        1630000000,
        false,
        1631000000,
        'test-product-id',
        1629000000,
        'eur',
        1900,
        'month',
        1
      )

      const subscriptions = await repository.getSubscriptionsByUserId(testUserId)

      expect(subscriptions.length).toBe(1)
      const subscription = subscriptions[0] as DbStripeSubscription
      expect(subscription.user_id).toBe(testUserId)
      expect(subscription.stripe_subscription_id).toBe('test-stripe-subscription-id')
      expect(subscription.status).toBe('active')
      expect(subscription.current_period_end).not.toBeNull()
      expect(new Date(subscription.current_period_end!).getTime()).toBe(1630000000 * 1000)
      expect(subscription.cancel_at_period_end).toBe(false)
      expect(subscription.trial_end).not.toBeNull()
      expect(new Date(subscription.trial_end!).getTime()).toBe(1631000000 * 1000)
      expect(subscription.stripe_product_id).toBe('test-product-id')
      expect(subscription.created_at).toBeInstanceOf(Date)
      expect(subscription.updated_at).toBeInstanceOf(Date)
      expect(subscription.amount).toBe('1900.000000')
      expect(subscription.currency).toBe('eur')
      expect(subscription.interval).toBe('month')
      expect(subscription.interval_count).toBe(1)
    })
  })

  describe('findSubscriptionByStripeId', () => {
    it('should find a subscription by its Stripe ID', async () => {
      const { id: testUserId } = await __createUserInSupabaseAndGetHisIdAndToken()

      await repository.insertSubscription(
        testUserId,
        'test-stripe-subscription-id',
        'active',
        1630000000,
        false,
        1631000000,
        'test-product-id',
        1629000000,
        'eur',
        1900,
        'month',
        1
      )

      const foundSubscription = await repository.findSubscriptionByStripeSubscriptionId('test-stripe-subscription-id')

      expect(foundSubscription).not.toBeNull()
      const subscription = foundSubscription as DbStripeSubscription
      expect(subscription.user_id).toBe(testUserId)
      expect(subscription.stripe_subscription_id).toBe('test-stripe-subscription-id')
      expect(subscription.status).toBe('active')
      expect(subscription.current_period_end).not.toBeNull()
      expect(new Date(subscription.current_period_end!).getTime()).toBe(1630000000 * 1000)
      expect(subscription.cancel_at_period_end).toBe(false)
      expect(subscription.trial_end).not.toBeNull()
      expect(new Date(subscription.trial_end!).getTime()).toBe(1631000000 * 1000)
      expect(subscription.stripe_product_id).toBe('test-product-id')
      expect(subscription.created_at).toBeInstanceOf(Date)
      expect(subscription.updated_at).toBeInstanceOf(Date)
      expect(subscription.amount).toBe('1900.000000')
      expect(subscription.currency).toBe('eur')
      expect(subscription.interval).toBe('month')
      expect(subscription.interval_count).toBe(1)
    })

    it('should return null for a non-existent Stripe subscription ID', async () => {
      const subscription = await repository.findSubscriptionByStripeSubscriptionId('non-existent-subscription-id')

      expect(subscription).toBeNull()
    })
  })
})
