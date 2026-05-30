export const mockCreateCheckoutSessionUrl = async (
  customerId: string,

  priceId: string,

  userId: string,

  successPathAndHash: string,

  cancelPathAndHash: string,

  trialDays: number | undefined,

  referral: string | null,

  couponId: string | undefined
): Promise<string> => {
  return 'https://checkout.stripe.com/pay/cs_test123'
}
