import request from 'supertest'
import { Express } from 'express'
import { __createStripeSubscriptionCreatedEvent, StripeEventBase } from './test-stripe-events'
import { getConfig } from '../../config/environment-config'
import { stripe } from '../../transport/third-party/stripe/stripe'

export const __simulateStripeEvent = async (testApp: Express, event: StripeEventBase): Promise<request.Response> => {
  const eventPayload = JSON.stringify(event)
  const secret = getConfig().stripeWebhookSecret
  const header = stripe.webhooks.generateTestHeaderString({
    payload: eventPayload,
    secret,
  })

  return request(testApp)
    .post('/api/v1/payment/stripe-webhook')
    .set({ 'Content-Type': 'application/json', 'Stripe-Signature': header })
    .send(eventPayload)
}

export const __simulateStripeSubscriptionCreatedEvent = async ({
  testApp,
  stripeCustomerId,
  userId,
}: {
  testApp: Express
  stripeCustomerId: string
  userId: string
}): Promise<boolean> => {
  // note that stripe sends more events right after card introduction, these are the 5 I've seen when creating stripe v2
  // checkout.session.completed
  // invoice.paid
  // invoice.payment_succeeded - this one is sent even though the user might not get charged (it's the start of the trial)
  // customer.subscription.created
  // invoice.upcoming - this one noticeably later than the other ones, by that time I was able to start using the app
  const responseToCustomerSubscriptionCreatedEvent: request.Response = await __simulateStripeEvent(
    testApp,
    // simulating only this one is enough to force our backend to sync the stripe subscription
    __createStripeSubscriptionCreatedEvent({
      stripeCustomerId,
      userId,
    })
  )
  return responseToCustomerSubscriptionCreatedEvent.status === 200
}
