export const mockCreateCheckoutSessionUrl = async (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  customerId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  priceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  successPathAndHash: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  cancelPathAndHash: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  trialDays: number | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  referral: string | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  couponId: string | undefined
): Promise<string | null> => {
  return 'https://checkout.stripe.com/pay/cs_test123'
}
