import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { __removeAllAuthUsersFromSupabase, buildTestApp } from '../../../test/test-utils'
import { __deleteAllHandledStripeEvents } from '../../../transport/database/webhook-events/handled-stripe-events-repository'
import { __simulateStripeEvent } from '../../../test/stripe/stripe-test-utils'
import { __createStripeChargeRefundedEvent } from '../../../test/stripe/test-stripe-events'

describe('webhooks-router', () => {
  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

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
})
