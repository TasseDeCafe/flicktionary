import './transport/third-party/sentry/sentry-initializer'
import * as Sentry from '@sentry/node'
import { FEATURES } from '@template-app/core/features'
import { getConfig } from './config/environment-config'
import { buildApp } from './app'
import { getEnvironmentName } from './utils/environment-utils'
import { RealResendApi } from './transport/third-party/resend/resend-api'
import { RealStripeApi } from './transport/third-party/stripe/stripe-api'
import { validateConfig } from './config/environment-config-validator'
import { RealRevenuecatApi } from './transport/third-party/revenuecat/revenuecat-api'
import { AccessCacheService } from './service/long-running/subscription-cache-service/access-cache-service'
import { StripeSubscriptionsRepository } from './transport/database/stripe-subscriptions/stripe-subscriptions-repository'
import { RevenuecatSubscriptionsRepository } from './transport/database/revenuecat-subscriptions/revenuecat-subscriptions-repository'
import { UsersRepository } from './transport/database/users/users-repository'
import { posthogClient, registerPosthogShutdownHandlers } from './transport/third-party/posthog/posthog-client'
import { setupExpressErrorHandler } from 'posthog-node'

console.log('The server is starting')

validateConfig(getConfig())

const startServer = async () => {
  try {
    const stripeSubscriptionsRepository = StripeSubscriptionsRepository()
    const revenueCatSubscriptionsRepository = RevenuecatSubscriptionsRepository()
    const usersRepository = UsersRepository()
    const accessCache = AccessCacheService(
      stripeSubscriptionsRepository,
      revenueCatSubscriptionsRepository,
      usersRepository
    )

    const expressApp = getConfig().shouldMockThirdParties
      ? buildApp({})
      : buildApp({
          stripeSubscriptionsRepository,
          revenuecatSubscriptionsRepository: revenueCatSubscriptionsRepository,
          accessCache,
          usersWithFreeAccess: getConfig().usersWithFreeAccess,
          resendApi: RealResendApi,
          ...(FEATURES.STRIPE && { stripeApi: RealStripeApi }),
          ...(FEATURES.REVENUECAT && { revenuecatApi: RealRevenuecatApi }),
        })

    if (FEATURES.SENTRY) {
      Sentry.setupExpressErrorHandler(expressApp)
    }
    if (FEATURES.POSTHOG) {
      setupExpressErrorHandler(posthogClient, expressApp)
    }

    const port = getConfig().port

    if (FEATURES.POSTHOG) {
      registerPosthogShutdownHandlers()
    }

    expressApp.listen(port, () => {
      console.log(`Server started in environment: ${getEnvironmentName()}`)
      console.log(`Try it on http://localhost:${port}/api/v1/database-health-check`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

startServer().then()
