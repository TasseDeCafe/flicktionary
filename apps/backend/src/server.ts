import './transport/third-party/sentry/sentry-initializer'
import * as Sentry from '@sentry/node'
import { FEATURES } from '@flicktionary/core/features'
import { getConfig } from './config/environment-config'
import { buildApp } from './app'
import { getEnvironmentName, isProduction } from './utils/environment-utils'
import { RealResendApi } from './transport/third-party/resend/resend-api'
import { RealStripeApi } from './transport/third-party/stripe/stripe-api'
import { validateConfig } from './config/environment-config-validator'
import { RealRevenuecatApi } from './transport/third-party/revenuecat/revenuecat-api'
import { AccessCacheService } from './service/long-running/subscription-cache-service/access-cache-service'
import { StripeSubscriptionsRepository } from './transport/database/stripe-subscriptions/stripe-subscriptions-repository'
import { RevenuecatSubscriptionsRepository } from './transport/database/revenuecat-subscriptions/revenuecat-subscriptions-repository'
import { UsersRepository } from './transport/database/users/users-repository'
import { ProcessingJobsRepository } from './transport/database/processing-jobs/processing-jobs-repository'
import { EnrichmentWorker } from './service/long-running/enrichment-worker/enrichment-worker'
import { buildProcessingDependencies } from './service/processing/processing-dependencies'
import { AnthropicPasses } from './transport/third-party/anthropic/anthropic-passes'
import { TelegramApi } from './transport/third-party/telegram/telegram-api'
import { TelegramPollingWorker } from './service/long-running/telegram-polling-worker/telegram-polling-worker'
import { TelegramPairNoncesRepository } from './transport/database/telegram-pair-nonces/telegram-pair-nonces-repository'
import { TelegramAuthNoncesRepository } from './transport/database/telegram-auth-nonces/telegram-auth-nonces-repository'
import { TelegramPendingImportsRepository } from './transport/database/telegram-pending-imports/telegram-pending-imports-repository'
import { UserTargetLanguagePrefsRepository } from './transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { StudySessionsRepository } from './transport/database/study-sessions/study-sessions-repository'
import { TextTracksRepository } from './transport/database/text-tracks/text-tracks-repository'
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
    const enrichmentWorker = EnrichmentWorker(ProcessingJobsRepository(), buildProcessingDependencies())

    const telegramApi = TelegramApi()
    // Dev transport only: production receives updates via the webhook, and
    // Telegram rejects getUpdates polling while a webhook is registered.
    const telegramPollingWorker = TelegramPollingWorker({
      anthropicPasses: AnthropicPasses(),
      telegramApi,
      usersRepository,
      telegramPairNoncesRepository: TelegramPairNoncesRepository(),
      telegramAuthNoncesRepository: TelegramAuthNoncesRepository(),
      telegramPendingImportsRepository: TelegramPendingImportsRepository(),
      userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepository(),
      studySessionsRepository: StudySessionsRepository(),
      textTracksRepository: TextTracksRepository(),
      processingJobsRepository: ProcessingJobsRepository(),
    })

    const expressApp = getConfig().shouldMockThirdParties
      ? buildApp({})
      : buildApp({
          stripeSubscriptionsRepository,
          revenuecatSubscriptionsRepository: revenueCatSubscriptionsRepository,
          accessCache,
          enrichmentWorker,
          usersWithFreeAccess: getConfig().usersWithFreeAccess,
          resendApi: RealResendApi,
          ...(FEATURES.STRIPE ? { stripeApi: RealStripeApi } : {}),
          ...(FEATURES.REVENUECAT ? { revenuecatApi: RealRevenuecatApi } : {}),
          ...(FEATURES.TELEGRAM ? { telegramApi } : {}),
          ...(FEATURES.TELEGRAM && !isProduction() ? { telegramPollingWorker } : {}),
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

void startServer()
