import { __generateUniqueId } from '../test-utils'
import { NUMBER_OF_DAYS_IN_FREE_TRIAL } from '@template-app/core/constants/pricing-constants'

export type EventType =
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'charge.refunded'
  | 'invoice.payment_succeeded'
  | 'checkout.session.completed'

// this is what we expect from every stripe event we receive, this is enough to synchronize the stripe subscription
export type StripeEventBase = {
  id: string
  data: {
    object: {
      customer: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any // This allows any additional string-keyed properties
    }
  }
  type: EventType
}

export const __createStripeSubscriptionCreatedEvent = ({
  stripeCustomerId,
  userId,
  subscriptionId = __generateUniqueId('sub'),
  referral = 'someReferral',
}: {
  stripeCustomerId: string
  userId: string
  subscriptionId?: string
  referral?: string
}): StripeEventBase => {
  const now: number = Date.now() / 1000
  return {
    id: __generateUniqueId('evt'),
    type: 'customer.subscription.created',
    data: {
      object: {
        customer: stripeCustomerId,
        id: subscriptionId,
        object: 'subscription',
        trial_end: now + NUMBER_OF_DAYS_IN_FREE_TRIAL * 24 * 60 * 60,
        cancel_at_period_end: false,
        items: {
          data: [
            {
              current_period_end: now + 30 * 24 * 60 * 60, // 30 days from now
              price: {
                product: 'someProductId',
                currency: 'eur',
                unit_amount: 1900,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                },
              },
            },
          ],
        },
        metadata: {
          user_id: userId,
          referral: referral,
        },
      },
    },
  }
}

export const __createStripeChargeRefundedEvent = ({
  stripeCustomerId,
  referral,
}: {
  stripeCustomerId: string
  referral?: string
  stripeSubscriptionId?: string
  amountPaid?: number
}): StripeEventBase => {
  const metadata: { referral: string } | undefined = referral ? { referral } : undefined
  return {
    id: __generateUniqueId('evt'),
    type: 'charge.refunded',
    data: {
      object: {
        id: __generateUniqueId('chg'),
        object: 'charge',
        amount: 1900,
        amount_refunded: 1000,
        customer: stripeCustomerId,
        metadata,
      },
    },
  }
}

export const __createStripeSubscriptionDeletedEvent = ({
  stripeCustomerId,
  userId,
}: {
  stripeCustomerId: string
  userId: string
}): StripeEventBase => {
  const metadata: { userId: string } | undefined = userId ? { userId } : undefined
  return {
    id: __generateUniqueId('evt'),
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: __generateUniqueId('chg'),
        object: 'charge',
        amount: 1900,
        amount_refunded: 1000,
        customer: stripeCustomerId,
        metadata,
      },
    },
  }
}
