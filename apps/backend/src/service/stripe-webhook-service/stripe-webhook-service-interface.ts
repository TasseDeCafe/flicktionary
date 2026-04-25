export interface StripeWebhookServiceInterface {
  syncStripeSubscriptionWithOurDbAndCache: (customerId: string) => Promise<boolean>
}
