import express, { Express, Request, Response } from 'express'
import morgan from 'morgan'
import helmet from 'helmet'
import cors from 'cors'

import { FEATURES } from '@flicktionary/core/features'
import { HealthCheckRouter } from './router/health-check-router/health-check-router'
import { SentryDebugRouter } from './router/sentry-debug-router/sentry-debug-router'
import { DevToolsRouter } from './router/dev-tools-router/dev-tools-router'
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
import { CoverageRouter } from './router/coverage-router/coverage-router'
import { CoverageSnapshotsRepository } from './transport/database/coverage-snapshots/coverage-snapshots-repository'
import { StatsRouter } from './router/stats-router/stats-router'
import { StatsRepository } from './transport/database/stats/stats-repository'
import { HighlightsRouter } from './router/highlights-router/highlights-router'
import type { WithTransaction } from './service/highlights/create-note-only-highlight'
import { GhostsRouter } from './router/ghosts-router/ghosts-router'
import { CardsRouter } from './router/cards-router/cards-router'
import { CardChatRouter } from './router/card-chat-router/card-chat-router'
import { ChunksRouter } from './router/chunks-router/chunks-router'
import { UserPrefsRouter } from './router/user-prefs-router/user-prefs-router'
import { beginTx } from './transport/database/postgres-client'
import { ContentSourcesRepository } from './transport/database/content-sources/content-sources-repository'
import { TextTracksRepository } from './transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepository } from './transport/database/text-segments/text-segments-repository'
import { StudySessionsRepository } from './transport/database/study-sessions/study-sessions-repository'
import { HighlightsRepository } from './transport/database/highlights/highlights-repository'
import { CardsRepository } from './transport/database/cards/cards-repository'
import { CardChatMessagesRepository } from './transport/database/card-chat-messages/card-chat-messages-repository'
import { UserTargetLanguagePrefsRepository } from './transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UserLookupsRepository } from './transport/database/user-lookups/user-lookups-repository'
import { StudyFacetsRepository } from './transport/database/study-facets/study-facets-repository'
import { PracticeTextsRepository } from './transport/database/practice-texts/practice-texts-repository'
import { PracticeExercisesRepository } from './transport/database/practice-exercises/practice-exercises-repository'
import { PracticeRatingEventsRepository } from './transport/database/practice-rating-events/practice-rating-events-repository'
import { ProcessingTelemetryRepository } from './transport/database/processing-telemetry/processing-telemetry-repository'
import { WiktionaryEntriesRepository } from './transport/database/wiktionary-entries/wiktionary-entries-repository'
import { WiktionaryMatchRepository } from './transport/database/wiktionary-entries/wiktionary-match-repository'
import { KnownLemmasRepository } from './transport/database/known-lemmas/known-lemmas-repository'
import { TextTrackLemmaProfilesRepository } from './transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import { LemmaRanksRepository } from './transport/database/lemma-ranks/lemma-ranks-repository'
import { StudySessionCheckpointsRepository } from './transport/database/study-sessions/study-session-checkpoints-repository'
import { ProcessingJobsRepository } from './transport/database/processing-jobs/processing-jobs-repository'
import { GhostCandidatesRepository } from './transport/database/ghost-candidates/ghost-candidates-repository'
import { NominatedWindowsRepository } from './transport/database/nominated-windows/nominated-windows-repository'
import {
  EnrichmentWorkerInterface,
  MockEnrichmentWorker,
} from './service/long-running/enrichment-worker/enrichment-worker'
import { PracticeRouter } from './router/practice-router/practice-router'
import { LanguagesRouter } from './router/languages-router/languages-router'
import { ExtensionAuthRouter } from './router/extension-auth-router/extension-auth-router'
import { GlossesRouter } from './router/glosses-router/glosses-router'
import { ExtensionPairNoncesRepository } from './transport/database/extension-pair-nonces/extension-pair-nonces-repository'
import { TelegramPairNoncesRepository } from './transport/database/telegram-pair-nonces/telegram-pair-nonces-repository'
import { TelegramPendingImportsRepository } from './transport/database/telegram-pending-imports/telegram-pending-imports-repository'
import { MockTelegramApi, TelegramApiInterface } from './transport/third-party/telegram/telegram-api'
import {
  MockTelegramPollingWorker,
  TelegramPollingWorkerInterface,
} from './service/long-running/telegram-polling-worker/telegram-polling-worker'
import { TelegramBotDependencies } from './service/telegram-bot/handle-telegram-update'
import { telegramWebhookRouter } from './router/webhooks/telegram/telegram-webhook-router'
import { TelegramPairRouter } from './router/telegram-pair-router/telegram-pair-router'
import { TelegramAuthRouter } from './router/telegram-auth-router/telegram-auth-router'
import { TelegramAuthNoncesRepository } from './transport/database/telegram-auth-nonces/telegram-auth-nonces-repository'
import { LessonImportRouter } from './router/lesson-import-router/lesson-import-router'
import { ImportBatchesRepository } from './transport/database/import-batches/import-batches-repository'
import { TeacherProfilesRepository } from './transport/database/teacher-profiles/teacher-profiles-repository'
import { AnthropicPasses, type AnthropicPassesInterface } from './transport/third-party/anthropic/anthropic-passes'

export type AppDependencies = {
  // Every LLM call goes through this seam; integration tests inject
  // MockAnthropicPasses with canned pass outputs to run LLM-adjacent flows
  // without network.
  anthropicPasses?: AnthropicPassesInterface
  stripeSubscriptionsRepository?: StripeSubscriptionsRepositoryInterface
  revenuecatSubscriptionsRepository?: RevenuecatSubscriptionsRepositoryInterface
  usersRepository?: UsersRepositoryInterface
  accessCache?: AccessCacheServiceInterface
  enrichmentWorker?: EnrichmentWorkerInterface
  usersWithFreeAccess?: string[]
  resendApi?: ResendApi
  stripeApi?: StripeApi
  revenuecatApi?: RevenuecatApi
  telegramApi?: TelegramApiInterface
  telegramPollingWorker?: TelegramPollingWorkerInterface
}

export const buildApp = ({
  anthropicPasses = AnthropicPasses(),
  stripeSubscriptionsRepository = StripeSubscriptionsRepository(),
  revenuecatSubscriptionsRepository = RevenuecatSubscriptionsRepository(),
  usersRepository = UsersRepository(),
  accessCache = MockAccessCacheService(
    StripeSubscriptionsRepository(),
    RevenuecatSubscriptionsRepository(),
    UsersRepository()
  ),
  enrichmentWorker = MockEnrichmentWorker(),
  usersWithFreeAccess = [],
  resendApi = MockResendApi,
  stripeApi = MockStripeApi,
  revenuecatApi = MockRevenuecatApi,
  telegramApi = MockTelegramApi(),
  telegramPollingWorker = MockTelegramPollingWorker(),
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

  // Shared by the webhook (prod transport), the pairing router, and the dev
  // polling worker (constructed in server.ts with these same repo factories).
  const telegramBotDependencies: TelegramBotDependencies = {
    anthropicPasses,
    telegramApi,
    usersRepository,
    telegramPairNoncesRepository: TelegramPairNoncesRepository(),
    telegramAuthNoncesRepository: TelegramAuthNoncesRepository(),
    telegramPendingImportsRepository: TelegramPendingImportsRepository(),
    userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepository(),
    studySessionsRepository: StudySessionsRepository(),
    textTracksRepository: TextTracksRepository(),
    processingJobsRepository: ProcessingJobsRepository(),
  }

  if (FEATURES.TELEGRAM) {
    // Authenticated by Telegram's secret-token header (checked in the router),
    // so it mounts with the other webhooks — before the user-JWT middleware.
    app.post(`${API_V1}/telegram/webhook`, telegramWebhookRouter(telegramBotDependencies))
  }

  app.use(helmet())

  app.use(
    cors({
      origin: getConfig().allowedCorsOrigins,
      credentials: true,
    })
  )

  if (getConfig().shouldRateLimit) {
    // Each card view in the focus view fans out into several parallel requests,
    // so quickly navigating between cards can burst dozens of requests in a second.
    // Keep these generous enough to absorb that while still catching runaway loops.
    app.use(createRateLimitMiddleware(80, 2))
    app.use(createRateLimitMiddleware(150, 10))
    app.use(createRateLimitMiddleware(1000, 200))
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

  if (FEATURES.TELEGRAM) {
    // Unauthenticated by design (the nonce is the credential) — must mount
    // before the user-JWT middleware. See telegram-auth-contract.ts.
    app.use(API_V1, TelegramAuthRouter(TelegramAuthNoncesRepository(), authUsersRepository))
  }

  app.use(tokenAuthenticationMiddleware)

  if (getConfig().shouldRateLimit) {
    const tenMinutes = 10 * 60
    app.use(
      createRateLimitMiddleware(5, tenMinutes, {
        skip: (req: Request) => req.path !== `${API_V1}/extension-auth/mint-session`,
        keyGenerator: (_req: Request, res: Response) => String(res.locals.userId ?? 'unknown-authenticated-user'),
      })
    )
  }

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
  const studyFacetsRepository = StudyFacetsRepository()
  const practiceTextsRepository = PracticeTextsRepository()
  const practiceExercisesRepository = PracticeExercisesRepository()
  const practiceRatingEventsRepository = PracticeRatingEventsRepository()
  const processingTelemetryRepository = ProcessingTelemetryRepository()
  const wiktionaryEntriesRepository = WiktionaryEntriesRepository()
  const processingJobsRepository = ProcessingJobsRepository()
  const ghostCandidatesRepository = GhostCandidatesRepository()
  const nominatedWindowsRepository = NominatedWindowsRepository()

  const cardStatusDependencies = {
    cardsRepository,
    studySessionsRepository,
    userLookupsRepository,
  }

  const exploreDependencies = {
    anthropicPasses,
    cardsRepository,
    studySessionsRepository,
    textSegmentsRepository,
    highlightsRepository,
    userLookupsRepository,
    usersRepository,
    userTargetLanguagePrefsRepository,
    contentSourcesRepository,
  }

  const createAdhocCardDependencies = {
    anthropicPasses,
    textSegmentsRepository,
    studySessionsRepository,
    highlightsRepository,
    cardsRepository,
    userLookupsRepository,
    studyFacetsRepository,
    usersRepository,
    userTargetLanguagePrefsRepository,
    processingTelemetryRepository,
    wiktionaryEntriesRepository,
  }

  const chatDependencies = {
    anthropicPasses,
    cardsRepository,
    cardChatMessagesRepository,
    studySessionsRepository,
    textSegmentsRepository,
    userLookupsRepository,
    usersRepository,
    userTargetLanguagePrefsRepository,
    contentSourcesRepository,
  }

  const withTransaction: WithTransaction = (fn) => beginTx(fn) as ReturnType<typeof fn>
  const noteOnlyHighlightDependencies = {
    highlightsRepository,
    cardsRepository,
    userLookupsRepository,
    ghostCandidatesRepository,
    withTransaction,
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
      processingJobsRepository,
    })
  )
  app.use(API_V1, TextSegmentsRouter(textTracksRepository, textSegmentsRepository, studySessionsRepository))
  const wiktionaryMatchRepository = WiktionaryMatchRepository()
  const knownLemmasRepository = KnownLemmasRepository()
  const checkpointDependencies = {
    studySessionsRepository,
    studySessionCheckpointsRepository: StudySessionCheckpointsRepository(),
    textSegmentsRepository,
    highlightsRepository,
    userLookupsRepository,
    studyFacetsRepository,
    practiceRatingEventsRepository,
    userTargetLanguagePrefsRepository,
    wiktionaryMatchRepository,
    anthropicPasses,
    withTransaction,
  }
  const textTrackLemmaProfilesRepository = TextTrackLemmaProfilesRepository()
  const lemmaRanksRepository = LemmaRanksRepository()
  const markKnownDependencies = {
    studySessionsRepository,
    textTracksRepository,
    textSegmentsRepository,
    textTrackLemmaProfilesRepository,
    userLookupsRepository,
    knownLemmasRepository,
    wiktionaryMatchRepository,
    lemmaRanksRepository,
    processingJobsRepository,
  }
  const difficultyDependencies = {
    studySessionsRepository,
    textTracksRepository,
    textSegmentsRepository,
    textTrackLemmaProfilesRepository,
    userLookupsRepository,
    knownLemmasRepository,
    lemmaRanksRepository,
    processingJobsRepository,
  }
  const coverageDependencies = {
    userTargetLanguagePrefsRepository,
    userLookupsRepository,
    knownLemmasRepository,
    lemmaRanksRepository,
    coverageSnapshotsRepository: CoverageSnapshotsRepository(),
  }

  app.use(API_V1, CoverageRouter(coverageDependencies))
  app.use(API_V1, StatsRouter({ statsRepository: StatsRepository(), authUsersRepository }))
  app.use(
    API_V1,
    StudySessionsRouter(
      studySessionsRepository,
      usersRepository,
      userTargetLanguagePrefsRepository,
      processingJobsRepository,
      textTracksRepository,
      highlightsRepository,
      anthropicPasses,
      checkpointDependencies,
      markKnownDependencies,
      difficultyDependencies
    )
  )
  app.use(
    API_V1,
    HighlightsRouter(
      highlightsRepository,
      studySessionsRepository,
      textSegmentsRepository,
      usersRepository,
      userTargetLanguagePrefsRepository,
      wiktionaryEntriesRepository,
      processingJobsRepository,
      ghostCandidatesRepository,
      noteOnlyHighlightDependencies,
      anthropicPasses,
      wiktionaryMatchRepository,
      knownLemmasRepository
    )
  )
  app.use(
    API_V1,
    GhostsRouter(studySessionsRepository, ghostCandidatesRepository, nominatedWindowsRepository, usersRepository)
  )
  app.use(
    API_V1,
    CardsRouter(
      cardsRepository,
      studySessionsRepository,
      exploreDependencies,
      cardStatusDependencies,
      createAdhocCardDependencies
    )
  )
  app.use(API_V1, CardChatRouter(cardChatMessagesRepository, cardsRepository, chatDependencies))
  app.use(
    API_V1,
    ChunksRouter(userLookupsRepository, {
      anthropicPasses,
      usersRepository,
      userTargetLanguagePrefsRepository,
      practiceExercisesRepository,
    })
  )
  app.use(
    API_V1,
    UserPrefsRouter(
      usersRepository,
      userTargetLanguagePrefsRepository,
      studySessionsRepository,
      userLookupsRepository,
      practiceRatingEventsRepository,
      practiceExercisesRepository
    )
  )
  app.use(API_V1, LanguagesRouter(anthropicPasses))
  app.use(API_V1, DevToolsRouter())
  app.use(
    API_V1,
    ExtensionAuthRouter(ExtensionPairNoncesRepository(), usersRepository, userTargetLanguagePrefsRepository)
  )
  if (FEATURES.TELEGRAM) {
    app.use(API_V1, TelegramPairRouter(telegramBotDependencies))
  }
  app.use(
    API_V1,
    GlossesRouter(
      usersRepository,
      userTargetLanguagePrefsRepository,
      wiktionaryEntriesRepository,
      anthropicPasses,
      wiktionaryMatchRepository,
      knownLemmasRepository
    )
  )
  app.use(
    API_V1,
    LessonImportRouter({
      importBatchesRepository: ImportBatchesRepository(),
      teacherProfilesRepository: TeacherProfilesRepository(),
      highlightsRepository,
      processingJobsRepository,
      textSegmentsRepository,
      userLookupsRepository,
      studyFacetsRepository,
      practiceRatingEventsRepository,
      userTargetLanguagePrefsRepository,
      usersRepository,
    })
  )
  app.use(
    API_V1,
    PracticeRouter({
      anthropicPasses,
      practiceTextsRepository,
      practiceExercisesRepository,
      practiceRatingEventsRepository,
      userLookupsRepository,
      studyFacetsRepository,
      usersRepository,
      userTargetLanguagePrefsRepository,
      studySessionsRepository,
    })
  )

  accessCache.initialize()
  enrichmentWorker.initialize()
  telegramPollingWorker.initialize()

  return app
}
