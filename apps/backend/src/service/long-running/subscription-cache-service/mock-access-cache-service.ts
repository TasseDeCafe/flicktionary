import { AccessCacheService, AccessCacheServiceInterface } from './access-cache-service'
import { StripeSubscriptionsRepositoryInterface } from '../../../transport/database/stripe-subscriptions/stripe-subscriptions-repository'
import { RevenuecatSubscriptionsRepositoryInterface } from '../../../transport/database/revenuecat-subscriptions/revenuecat-subscriptions-repository'
import { UsersRepositoryInterface } from '../../../transport/database/users/users-repository'

export const MockAccessCacheService = (
  stripeSubscriptionsRepository: StripeSubscriptionsRepositoryInterface,
  revenueCatSubscriptionsRepository: RevenuecatSubscriptionsRepositoryInterface,
  usersRepositoryInterface: UsersRepositoryInterface
): AccessCacheServiceInterface => {
  return {
    // mocked subscription cache should work the same as the real one...
    ...AccessCacheService(stripeSubscriptionsRepository, revenueCatSubscriptionsRepository, usersRepositoryInterface),
    // ... except for the long running task
    initialize: async (): Promise<void> => {
      // No-op for mock
      // IMPORTANT
      // we do not want to have asynchronous calls to our test database during our tests,
      // it could lead to flay tests and race conditions
    },

    stop: (): void => {
      // No-op for mock
    },
  }
}
