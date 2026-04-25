import { DbStripeSubscription } from '../../../transport/database/stripe-subscriptions/stripe-subscriptions-repository'

export const isStripeSubscriptionActive = (subscription: DbStripeSubscription): boolean => {
  const now = new Date()

  switch (subscription.status) {
    case 'active':
      if (subscription.cancel_at_period_end) {
        return subscription.current_period_end !== null && now < new Date(subscription.current_period_end)
      }
      return true
    case 'trialing':
      return subscription.trial_end === null || now < new Date(subscription.trial_end)
    case 'past_due':
      if (subscription.current_period_end === null) return false
      const graceEndDate = new Date(subscription.current_period_end)
      graceEndDate.setDate(graceEndDate.getDate() + 3)
      return now < graceEndDate
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return false
    case 'incomplete':
      const oneDayAfterCreation = new Date(new Date(subscription.created_at).getTime() + 24 * 60 * 60 * 1000)
      return now < oneDayAfterCreation
    default:
      return false
  }
}
