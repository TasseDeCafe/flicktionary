import { stripe } from '../stripe'
import { logCustomErrorMessageAndError } from '../../sentry/error-monitoring'

export const createCustomerWithMetadata = async (
  userId: string,
  userEmail: string,
  referral: string | null
): Promise<string | null> => {
  try {
    const customer = await stripe.customers.create({
      email: userEmail,
      metadata: { user_id: userId, referral },
    })
    return customer.id
  } catch (error) {
    logCustomErrorMessageAndError(`createCustomerWithMetadata error, userId - ${userId}, referral - ${referral}`, error)
    return null
  }
}
