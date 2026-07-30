import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { PostHog } from 'posthog-node'
import {
  __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding,
  __generateUniqueId,
  buildTestApp,
} from '../../../test/test-utils'
import { __simulateStripeEvent } from '../../../test/stripe/stripe-test-utils'
import {
  __createStripeChargeRefundedEvent,
  __createStripeSubscriptionCreatedEvent,
} from '../../../test/stripe/test-stripe-events'

type CapturedEvent = { distinctId: string; event: string; properties?: Record<string, unknown> }

// The real client is a no-op in tests (empty token), so product-event
// assertions go through this recording fake injected via AppDependencies.
const buildRecordingPosthogClient = () => {
  const captured: CapturedEvent[] = []
  const client = { capture: (payload: CapturedEvent) => captured.push(payload) } as unknown as PostHog
  return { captured, client }
}

describe('webhooks-router', () => {
  describe('simple failures', () => {
    it('should return 400 for invalid signature', async () => {
      const testApp = buildTestApp()
      const stripeCustomerId = 'some_stripe_customer_id'
      const event = __simulateStripeEvent(
        testApp,
        __createStripeChargeRefundedEvent({
          stripeCustomerId,
        })
      )
      const payload = JSON.stringify(event)

      const response = await request(testApp)
        .post('/api/v1/payment/stripe-webhook')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 'invalid_signature')
        .send(payload)

      expect(response.status).toBe(400)
    })

    it('should return 400 for unsupported event type', async () => {
      const testApp = buildTestApp()
      const stripeCustomerId = 'some_stripe_customer_id'
      const event = __createStripeChargeRefundedEvent({ stripeCustomerId })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      event.type = 'some.unsupported.event.type' as any
      const response = await __simulateStripeEvent(testApp, event)
      expect(response.status).toBe(400)
    })
  })

  describe('subscription_activated capture', () => {
    it('captures subscription_activated exactly once for the initial activation, not on repeat syncs', async () => {
      const { captured, client } = buildRecordingPosthogClient()
      const stripeCustomerId = __generateUniqueId('cus')

      // Checkout + first subscription webhook: the sync writes a new
      // 'trialing' row, which is the activation transition.
      const { id: userId, testApp } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({
        appDependencies: { posthogClient: client },
        stripeCustomerId,
      })

      expect(captured).toHaveLength(1)
      expect(captured[0].distinctId).toBe(userId)
      expect(captured[0].event).toBe('subscription_activated')
      expect(captured[0].properties).toMatchObject({
        status: 'trialing',
        previous_status: null,
        interval: 'month',
        interval_count: 1,
        amount: 1900,
        currency: 'eur',
      })

      // A later webhook for the same still-trialing subscription re-syncs
      // (fresh event id, so idempotency doesn't skip it) but sees an unchanged
      // status and must stay silent.
      const response = await __simulateStripeEvent(
        testApp,
        __createStripeSubscriptionCreatedEvent({ stripeCustomerId, userId })
      )
      expect(response.status).toBe(200)
      expect(captured).toHaveLength(1)
    })
  })
})
