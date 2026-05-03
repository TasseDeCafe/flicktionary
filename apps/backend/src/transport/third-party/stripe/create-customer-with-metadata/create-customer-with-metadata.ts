import { stripe } from '../stripe'

export const createCustomerWithMetadata = async (
  userId: string,
  userEmail: string,
  referral: string | null
): Promise<string> => {
  const customer = await stripe.customers.create({
    email: userEmail,
    metadata: { user_id: userId, referral },
  })
  return customer.id
}
