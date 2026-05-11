import { stripe } from '../stripe'

export const createBillingPortalUrl = async (customerId: string, returnUrl: string): Promise<string> => {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })

  return session.url
}
