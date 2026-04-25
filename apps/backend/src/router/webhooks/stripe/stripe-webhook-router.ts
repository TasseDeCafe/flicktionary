import { Request, Response } from 'express'
import { getConfig } from '../../../config/environment-config'
import Stripe from 'stripe'
import { logWithSentry } from '../../../transport/third-party/sentry/error-monitoring'
import { stripe } from '../../../transport/third-party/stripe/stripe'
import { handleEventIdempotently } from '../../../transport/database/webhook-events/handled-stripe-events-repository'
import { StripeWebhookServiceInterface } from '../../../service/stripe-webhook-service/stripe-webhook-service-interface'
import { createResponseWithOneError } from '../../router-utils'

// todo: stripe v2, toggle "limit customers to one subscription" on in production

// we consider stripe backend to be the ultimate source of truth for subscriptions
// look at this repo https://github.com/t3dotgg/stripe-recommendations?tab=readme-ov-file#events-i-track
// which was our inspiration for the 2nd version of our stripe implementation
// you can see all the event types here: https://docs.stripe.com/api/events/types
// the below events have to match  the ones listed in https://dashboard.stripe.com/webhooks
const EVENTS_THAT_SHOULD_TRIGGER_SUBSCRIPTION_SYNC: Stripe.Event.Type[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'invoice.upcoming',
  'invoice.marked_uncollectible',
  'invoice.payment_succeeded',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
]

const EVENT_TYPES_SUPPORTED_BY_US = ['charge.refunded', ...EVENTS_THAT_SHOULD_TRIGGER_SUBSCRIPTION_SYNC]

export const stripeWebhookRouter =
  (webhookService: StripeWebhookServiceInterface) => async (req: Request, res: Response) => {
    let event: Stripe.Event
    try {
      const signature = req.headers['stripe-signature'] as string
      event = stripe.webhooks.constructEvent(req.body, signature, getConfig().stripeWebhookSecret)
    } catch (error) {
      logWithSentry({
        message: 'Error processing stripe webhooks',
        params: {
          event: req.body,
        },
        error,
      })
      res.status(400).json(createResponseWithOneError('Error processing webhooks'))
      return
    }
    if (!EVENT_TYPES_SUPPORTED_BY_US.includes(event.type)) {
      logWithSentry({
        message: 'Unsupported event type',
        params: {
          event,
        },
      })
      res.status(400).send()
      return
    }

    const wasHandled: boolean = await handleEventIdempotently(event.id, async () => {
      if (EVENTS_THAT_SHOULD_TRIGGER_SUBSCRIPTION_SYNC.includes(event.type)) {
        const { customer: stripeCustomerId } = event?.data?.object as {
          customer: string
        }
        if (!stripeCustomerId) {
          logWithSentry({
            message: 'stripeCustomerId is missing',
            params: {
              event,
            },
          })
        }
        const wasSyncingProcessedSuccessfully =
          await webhookService.syncStripeSubscriptionWithOurDbAndCache(stripeCustomerId)
        if (!wasSyncingProcessedSuccessfully) {
          logWithSentry({
            message: 'subscription was not synced successfully',
            params: {
              event,
            },
          })
        }
      }
    })

    if (!wasHandled) {
      logWithSentry({
        message: 'Duplicate event received and skipped',
        params: { event },
      })
    }
    res.status(200).send()
  }
