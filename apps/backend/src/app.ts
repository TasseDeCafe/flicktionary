import express, { Express, Request } from 'express'
import morgan from 'morgan'
import helmet from 'helmet'
import cors from 'cors'

import { FEATURES } from '@flicktionary/core/features'
import { HealthCheckRouter } from './router/health-check-router/health-check-router'
import { SentryDebugRouter } from './router/sentry-debug-router/sentry-debug-router'
import { getConfig } from './config/environment-config'
import { tokenAuthenticationMiddleware } from './middleware/token-authentication-middleware'
import { requestContextMiddleware } from './middleware/request-context-middleware'
import { slowDownMiddleware } from './middleware/slow-down-middleware'
import { createRateLimitMiddleware } from './middleware/rate-limiting-middleware'
import { ContactEmailRouter } from './router/contact-email-router/contact-email-router'
import { CheckoutRouter } from './router/checkout-router/checkout-router'
import { stripeWebhookRouter } from './router/webhooks/stripe/stripe-webhook-router'
import { subscriptionMiddleware } from './middleware/subscription-middleware'
import { BillingRouter } from './router/billing-router/billing-router'
import { MockResendApi, ResendApi } from './transport/third-party/resend/resend-api'
import { removalsRouter } from './router/removals-router/removals-router'
import { MockStripeApi, StripeApi } from './transport/third-party/stripe/stripe-api'
import { authenticationRouter } from './router/authentication-router/authentication-router'
import { BillingService } from './service/get-subscription-account-data-service/billing-service'
import { PortalSessionRouter } from './router/portal-session-router/portal-session-router'
import { buildAuthUsersRepository } from './transport/database/auth-users/auth-users-repository'
import { MockRevenuecatApi, RevenuecatApi } from './transport/third-party/revenuecat/revenuecat-api'
import { revenuecatWebhookRouter } from './router/webhooks/revenuecat/revenuecat-webhook-router'
import { buildHandledRevenuecatEventsRepository } from './transport/database/webhook-events/handled-revenuecat-events-repository'
import { UserRouter } from './router/user-router/user-router'
import {
  StripeSubscriptionsRepository,
  StripeSubscriptionsRepositoryInterface,
} from './transport/database/stripe-subscriptions/stripe-subscriptions-repository'
import { StripeService } from './service/stripe-service/stripe-service'
import { AccessCacheServiceInterface } from './service/long-running/subscription-cache-service/access-cache-service'
import { MockAccessCacheService } from './service/long-running/subscription-cache-service/mock-access-cache-service'
import { UsersRepository, UsersRepositoryInterface } from './transport/database/users/users-repository'
import { StripeWebhookService } from './service/stripe-webhook-service/stripe-webhook-service'
import {
  RevenuecatSubscriptionsRepository,
  RevenuecatSubscriptionsRepositoryInterface,
} from './transport/database/revenuecat-subscriptions/revenuecat-subscriptions-repository'
import { configRouter } from './router/config-router/config-router'
import { RevenuecatService } from './service/revenuecat-service/revenuecat-service'
import { orpcRelativePaths } from './router/orpc/orpc-paths'
import { ContentSourcesRouter } from './router/content-sources-router/content-sources-router'
import { TextTracksRouter } from './router/text-tracks-router/text-tracks-router'
import { TextSegmentsRouter } from './router/text-segments-router/text-segments-router'
import { StudySessionsRouter } from './router/study-sessions-router/study-sessions-router'
import { HighlightsRouter } from './router/highlights-router/highlights-router'
import { CardsRouter } from './router/cards-router/cards-router'
import { CardChatRouter } from './router/card-chat-router/card-chat-router'
import { ChunksRouter } from './router/chunks-router/chunks-router'
import { UserPrefsRouter } from './router/user-prefs-router/user-prefs-router'
import { ContentSourcesRepository } from './transport/database/content-sources/content-sources-repository'
import { TextTracksRepository } from './transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepository } from './transport/database/text-segments/text-segments-repository'
import { StudySessionsRepository } from './transport/database/study-sessions/study-sessions-repository'
import { HighlightsRepository } from './transport/database/highlights/highlights-repository'
import { CardsRepository } from './transport/database/cards/cards-repository'
import { CardChatMessagesRepository } from './transport/database/card-chat-messages/card-chat-messages-repository'
import { UserTargetLanguagePrefsRepository } from './transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UserLookupsRepository } from './transport/database/user-lookups/user-lookups-repository'
import { PracticeSessionsRepository } from './transport/database/practice-sessions/practice-sessions-repository'
import { PracticeTextsRepository } from './transport/database/practice-texts/practice-texts-repository'
import { PracticeRatingsRepository } from './transport/database/practice-ratings/practice-ratings-repository'
import { ProcessingTelemetryRepository } from './transport/database/processing-telemetry/processing-telemetry-repository'
import { WiktionaryEntriesRepository } from './transport/database/wiktionary-entries/wiktionary-entries-repository'
import { PracticeRouter } from './router/practice-router/practice-router'
import { LanguagesRouter } from './router/languages-router/languages-router'

export type AppDependencies = {
  stripeSubscriptionsRepository?: StripeSubscriptionsRepositoryInterface
  revenuecatSubscriptionsRepository?: RevenuecatSubscriptionsRepositoryInterface
  usersRepository?: UsersRepositoryInterface
  accessCache?: AccessCacheServiceInterface
  usersWithFreeAccess?: string[]
  resendApi?: ResendApi
  stripeApi?: StripeApi
  revenuecatApi?: RevenuecatApi
}

export const buildApp = ({
  stripeSubscriptionsRepository = StripeSubscriptionsRepository(),
  revenuecatSubscriptionsRepository = RevenuecatSubscriptionsRepository(),
  usersRepository = UsersRepository(),
  accessCache = MockAccessCacheService(
    StripeSubscriptionsRepository(),
    RevenuecatSubscriptionsRepository(),
    UsersRepository()
  ),
  usersWithFreeAccess = ['user.with.free.access@email.com'],
  resendApi = MockResendApi,
  stripeApi = MockStripeApi,
  revenuecatApi = MockRevenuecatApi,
}: AppDependencies): Express => {
  const app: Express = express()

  app.use(requestContextMiddleware)

  const API_V1 = '/api/v1'

  // cloudflare tunnel acts as a reverse proxy, so we need to trust the first proxy
  // in production, cloudflare also proxies the requests.
  app.set('trust proxy', 1)

  if (getConfig().shouldLogRequests) {
    app.use(morgan(':date[iso] :method :url :status :response-time ms'))
  }

  const authUsersRepository = buildAuthUsersRepository()

  const stripeService = StripeService(stripeApi, usersRepository)
  const revenuecatService = RevenuecatService(accessCache, revenuecatSubscriptionsRepository, revenuecatApi)

  if (FEATURES.STRIPE) {
    const stripeWebhookService = StripeWebhookService(
      stripeApi,
      stripeSubscriptionsRepository,
      accessCache,
      usersRepository
    )

    // Stripe webhooks route - should be before the json parser
    // https://docs.stripe.com/webhooks/quickstart
    // this has to match the webhooks in the dashboard: https://dashboard.stripe.com/webhooks
    app.post(
      `${API_V1}/payment/stripe-webhook`,
      express.raw({ type: 'application/json' }),
      stripeWebhookRouter(stripeWebhookService)
    )
  }

  const bodySizeLimit = '4mb' // if you need to change this value, also change it in nginx.
  const jsonParser = express.json({ limit: bodySizeLimit })
  const urlencodedParser = express.urlencoded({ limit: bodySizeLimit })

  const shouldSkipBodyParsingForOrpc = (path: string) =>
    orpcRelativePaths.some((route) => path === `${API_V1}${route}` || path.startsWith(`${API_V1}${route}/`))

  app.use((req, res, next) => {
    if (shouldSkipBodyParsingForOrpc(req.path)) {
      next()
      return
    }

    jsonParser(req, res, next)
  })

  app.use((req, res, next) => {
    if (shouldSkipBodyParsingForOrpc(req.path)) {
      next()
      return
    }

    urlencodedParser(req, res, next)
  })

  if (FEATURES.REVENUECAT) {
    const handledRevenuecatEventsRepository = buildHandledRevenuecatEventsRepository()

    // The RevenueCat webhook router doesn't need to be defined before the JSON parser
    app.post(
      `${API_V1}/payment/revenuecat-webhook`,
      revenuecatWebhookRouter(handledRevenuecatEventsRepository, authUsersRepository, revenuecatService)
    )
  }

  app.use(helmet())

  app.use(
    cors({
      origin: getConfig().allowedCorsOrigins,
      credentials: true,
    })
  )

  if (getConfig().shouldRateLimit) {
    app.use(createRateLimitMiddleware(30, 2))
    app.use(createRateLimitMiddleware(50, 10))
    app.use(createRateLimitMiddleware(500, 200))
  }

  if (getConfig().shouldSlowDownApiRoutes) {
    app.use(slowDownMiddleware)
  }

  const billingService = BillingService(
    usersRepository,
    stripeSubscriptionsRepository,
    revenuecatSubscriptionsRepository,
    revenuecatService
  )
  app.use(API_V1, configRouter())
  app.use(API_V1, HealthCheckRouter())
  app.use(API_V1, SentryDebugRouter())

  // Apply IP-based rate limiting specifically to authentication routes
  // This is done at the app level to avoid affecting other /api/v1 routes
  if (getConfig().shouldRateLimit) {
    const authRateLimitOptions = {
      skip: (req: Request) => !req.path.startsWith(`${API_V1}/authentication`),
    }
    const tenMinutes = 10 * 60
    const oneDay = 24 * 60 * 60

    app.use(createRateLimitMiddleware(30, oneDay, authRateLimitOptions))
    app.use(createRateLimitMiddleware(10, tenMinutes, authRateLimitOptions))
  }

  app.use(API_V1, authenticationRouter())
  app.use(API_V1, ContactEmailRouter(resendApi))

  app.use(tokenAuthenticationMiddleware)
  app.use(API_V1, removalsRouter(authUsersRepository, usersRepository, stripeApi, stripeSubscriptionsRepository))
  app.use(API_V1, UserRouter(usersRepository))
  app.use(API_V1, BillingRouter(billingService, usersWithFreeAccess))
  if (FEATURES.STRIPE) {
    app.use(API_V1, PortalSessionRouter(usersRepository, stripeApi))
    app.use(API_V1, CheckoutRouter(stripeService))
  }

  const contentSourcesRepository = ContentSourcesRepository()
  const textTracksRepository = TextTracksRepository()
  const textSegmentsRepository = TextSegmentsRepository()
  const studySessionsRepository = StudySessionsRepository()
  const highlightsRepository = HighlightsRepository()
  const cardsRepository = CardsRepository()
  const cardChatMessagesRepository = CardChatMessagesRepository()
  const userTargetLanguagePrefsRepository = UserTargetLanguagePrefsRepository()
  const userLookupsRepository = UserLookupsRepository()
  const practiceSessionsRepository = PracticeSessionsRepository()
  const practiceTextsRepository = PracticeTextsRepository()
  const practiceRatingsRepository = PracticeRatingsRepository()
  const processingTelemetryRepository = ProcessingTelemetryRepository()
  const wiktionaryEntriesRepository = WiktionaryEntriesRepository()

  const processingDependencies = {
    contentSourcesRepository,
    textTracksRepository,
    textSegmentsRepository,
    studySessionsRepository,
    highlightsRepository,
    cardsRepository,
    userLookupsRepository,
    usersRepository,
    processingTelemetryRepository,
    wiktionaryEntriesRepository,
  }

  const exportDependencies = {
    cardsRepository,
    textSegmentsRepository,
    studySessionsRepository,
    userLookupsRepository,
  }

  const setCardStatusDependencies = {
    cardsRepository,
    studySessionsRepository,
    userLookupsRepository,
  }

  const startPracticeSessionDependencies = {
    practiceSessionsRepository,
    userLookupsRepository,
    usersRepository,
  }

  const generateNextPracticeTextDependencies = {
    practiceSessionsRepository,
    practiceTextsRepository,
    practiceRatingsRepository,
    userLookupsRepository,
    usersRepository,
  }

  const rateChunkDependencies = {
    practiceTextsRepository,
    practiceRatingsRepository,
    userLookupsRepository,
  }

  const exploreDependencies = {
    cardsRepository,
    studySessionsRepository,
    textSegmentsRepository,
    highlightsRepository,
    userLookupsRepository,
  }

  const createAdhocCardDependencies = {
    textSegmentsRepository,
    studySessionsRepository,
    highlightsRepository,
    cardsRepository,
    userLookupsRepository,
    usersRepository,
    userTargetLanguagePrefsRepository,
    processingTelemetryRepository,
    wiktionaryEntriesRepository,
  }

  const chatDependencies = {
    cardsRepository,
    cardChatMessagesRepository,
    studySessionsRepository,
    textSegmentsRepository,
    userLookupsRepository,
  }

  const subscriptionMiddlewareInstance = subscriptionMiddleware(accessCache, usersWithFreeAccess)
  app.use(subscriptionMiddlewareInstance)

  app.use(API_V1, ContentSourcesRouter(contentSourcesRepository))
  app.use(
    API_V1,
    TextTracksRouter({
      contentSourcesRepository,
      textTracksRepository,
      textSegmentsRepository,
    })
  )
  app.use(API_V1, TextSegmentsRouter(textTracksRepository, textSegmentsRepository, studySessionsRepository))
  app.use(API_V1, StudySessionsRouter(studySessionsRepository, usersRepository, processingDependencies))
  app.use(API_V1, HighlightsRouter(highlightsRepository, studySessionsRepository, textSegmentsRepository))
  app.use(
    API_V1,
    CardsRouter(
      cardsRepository,
      studySessionsRepository,
      exportDependencies,
      exploreDependencies,
      setCardStatusDependencies,
      createAdhocCardDependencies
    )
  )
  app.use(API_V1, CardChatRouter(cardChatMessagesRepository, cardsRepository, chatDependencies))
  app.use(API_V1, ChunksRouter(userLookupsRepository))
  app.use(API_V1, UserPrefsRouter(usersRepository, userTargetLanguagePrefsRepository))
  app.use(API_V1, LanguagesRouter())
  app.use(
    API_V1,
    PracticeRouter({
      practiceSessionsRepository,
      practiceTextsRepository,
      userLookupsRepository,
      usersRepository,
      startPracticeSessionDependencies,
      generateNextPracticeTextDependencies,
      rateChunkDependencies,
      finalizePracticeTextDependencies: rateChunkDependencies,
    })
  )

  accessCache.initialize()

  return app
}
