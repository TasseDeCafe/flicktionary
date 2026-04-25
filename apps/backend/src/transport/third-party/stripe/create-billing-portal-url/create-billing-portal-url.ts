import { stripe } from '../stripe'
import { logCustomErrorMessageAndError } from '../../sentry/error-monitoring'

export const createBillingPortalUrl = async (customerId: string, returnUrl: string): Promise<string | null> => {
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })

    return session.url
  } catch (error) {
    logCustomErrorMessageAndError(
      `createBillingPortalUrl error, customerId - ${customerId}, returnUrl - ${returnUrl}`,
      error
    )
    return null
  }
}
