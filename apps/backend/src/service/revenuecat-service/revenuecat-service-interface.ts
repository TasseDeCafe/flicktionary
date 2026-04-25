export interface RevenuecatServiceInterface {
  syncRevenuecatSubscriptionWithOurDbAndCache: (userId: string) => Promise<void>
}
