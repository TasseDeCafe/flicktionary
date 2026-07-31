import {
  getEnvironmentName,
  isDevelopment,
  isDevelopmentTunnel,
  isDevelopmentWithoutThirdParties,
  isDevelopmentWithoutThirdPartiesTunnel,
  isProduction,
  isTest,
} from '../utils/environment-utils'
import { FEATURES } from '@flicktionary/core/features'
import { parseEmails } from './environment-config-utils'
import { EnvironmentConfig } from './environment-config-schema'

const parseAutoSeedPattern = (raw: string | undefined): RegExp | null => {
  if (!raw) return null
  try {
    return new RegExp(raw)
  } catch {
    return null
  }
}

const devAutoSeedEmailPattern = parseAutoSeedPattern(process.env.DEV_AUTOSEED_EMAIL_PATTERN)
const devAutoSeedNativeLanguage = process.env.DEV_AUTOSEED_NATIVE_LANGUAGE || 'fr'

// Guest kill switch: defaults to off, so a missing Doppler var can never open
// guest access by accident.
const isGuestModeEnabled = process.env.GUEST_MODE_ENABLED === 'true'

// Guest source cap: tunable without a code change (see the schema comment).
// A malformed value falls back to the default instead of parsing to NaN —
// config validation only logs, and `count >= NaN` is always false, which
// would silently disable the cap.
const parsedMaxSourcesPerGuest = parseInt(process.env.MAX_SOURCES_PER_GUEST || '3', 10)
const maxSourcesPerGuest = Number.isNaN(parsedMaxSourcesPerGuest) ? 3 : parsedMaxSourcesPerGuest

// Browser extension origins. We allow any chrome- or moz-extension origin during
// development; once we have stable published extension IDs the patterns can be
// tightened to those specific IDs. The cors package treats string values
// containing '*' as literal matches, not wildcards, so these MUST be RegExp.
const extensionOrigins: RegExp[] = [/^chrome-extension:\/\/[a-z]{32}$/, /^moz-extension:\/\/[0-9a-f-]+$/]

const productionConfig: EnvironmentConfig = {
  environmentName: 'production',
  // Railway injects PORT env var, fallback to 4004 for other deployments
  port: parseInt(process.env.PORT || '4004', 10),
  webUrl: 'https://app.flicktionary.app',
  shouldLogRequests: false,
  allowedCorsOrigins: [
    'https://flicktionary.app',
    'https://www.flicktionary.app',
    'https://app.flicktionary.app',
    /https:\/\/.*-fluencist\.vercel\.app(\/.*)?/, // Vercel Preview URLs
    /https:\/\/.*\.up\.railway\.app(\/.*)?/, // Railway Preview URLs
    ...extensionOrigins,
  ],
  resendApiKey: process.env.RESEND_API_KEY || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  tmdbApiKey: process.env.TMDB_API_KEY || '',
  openSubtitlesApiKey: process.env.OPENSUBTITLES_API_KEY || '',
  openSubtitlesUserAgent: process.env.OPENSUBTITLES_USER_AGENT || '',
  stripeSecretKey: FEATURES.STRIPE ? process.env.STRIPE_SECRET_KEY || '' : '',
  stripeWebhookSecret: FEATURES.STRIPE ? process.env.STRIPE_WEBHOOK_SECRET || '' : '',
  stripeMonthlyPriceInEurId: FEATURES.STRIPE ? process.env.STRIPE_MONTHLY_PRICE_IN_EUR_ID || '' : '',
  stripeYearlyPriceInEurId: FEATURES.STRIPE ? process.env.STRIPE_YEARLY_PRICE_IN_EUR_ID || '' : '',
  supabaseJwksUri: process.env.SUPABASE_JWKS_URI || '',
  supabaseConnectionString: process.env.SUPABASE_CONNECTION_STRING || '',
  supabaseProjectUrl: process.env.SUPABASE_PROJECT_URL || '',
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || '',
  revenuecatApiKey: FEATURES.REVENUECAT ? process.env.REVENUECAT_API_KEY || '' : '',
  revenuecatProjectId: FEATURES.REVENUECAT ? process.env.REVENUECAT_PROJECT_ID || '' : '',
  revenuecatWebhookAuthHeader: FEATURES.REVENUECAT ? process.env.REVENUECAT_WEBHOOK_AUTH_HEADER || '' : '',
  posthogProjectToken: FEATURES.POSTHOG ? process.env.POSTHOG_PROJECT_TOKEN || '' : '',
  telegramBotToken: FEATURES.TELEGRAM ? process.env.TELEGRAM_BOT_TOKEN || '' : '',
  telegramWebhookSecret: FEATURES.TELEGRAM ? process.env.TELEGRAM_WEBHOOK_SECRET || '' : '',
  shouldRateLimit: true,
  shouldMockThirdParties: false,
  shouldSlowDownApiRoutes: false,
  usersWithFreeAccess: parseEmails(process.env.USERS_WITH_FREE_ACCESS || '').validEmails,
  emailsOfTestUsers: parseEmails(process.env.EMAILS_OF_TEST_USERS || '').validEmails,
  devAutoSeedEmailPattern,
  devAutoSeedNativeLanguage,
  isGuestModeEnabled,
  maxSourcesPerGuest,
  featureFlags: {
    isCreditCardRequiredForAll: () => false,
    shouldAppBeFreeForEveryone: () => true,
  },
}

const developmentConfig: EnvironmentConfig = {
  environmentName: 'development',
  port: 4003,
  webUrl: 'http://localhost:5174',
  shouldLogRequests: true,
  allowedCorsOrigins: [
    'http://localhost:5174',
    'http://localhost:4173', // "yarn preview" origin
    ...extensionOrigins,
  ],
  resendApiKey: process.env.RESEND_API_KEY || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  tmdbApiKey: process.env.TMDB_API_KEY || '',
  openSubtitlesApiKey: process.env.OPENSUBTITLES_API_KEY || '',
  openSubtitlesUserAgent: process.env.OPENSUBTITLES_USER_AGENT || 'Flicktionary v0.0.1',
  stripeSecretKey: FEATURES.STRIPE ? process.env.STRIPE_SECRET_KEY || '' : '',
  stripeWebhookSecret: FEATURES.STRIPE ? process.env.STRIPE_WEBHOOK_SECRET || '' : '',
  stripeMonthlyPriceInEurId: FEATURES.STRIPE ? process.env.STRIPE_MONTHLY_PRICE_IN_EUR_ID || '' : '',
  stripeYearlyPriceInEurId: FEATURES.STRIPE ? process.env.STRIPE_YEARLY_PRICE_IN_EUR_ID || '' : '',
  // Local development uses JWKS endpoint from local Supabase (supabase-dev)
  // This provides production parity - asymmetric JWT verification
  supabaseJwksUri: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
  supabaseConnectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  // shown by `yarn db:dev` command
  supabaseProjectUrl: 'http://127.0.0.1:54321',
  // Secret API key generated by Supabase with signing keys (stable, tied to signing_key.json)
  supabaseSecretKey: 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz',
  revenuecatApiKey: FEATURES.REVENUECAT ? process.env.REVENUECAT_API_KEY || '' : '',
  revenuecatProjectId: FEATURES.REVENUECAT ? process.env.REVENUECAT_PROJECT_ID || '' : '',
  revenuecatWebhookAuthHeader: FEATURES.REVENUECAT ? process.env.REVENUECAT_WEBHOOK_AUTH_HEADER || '' : '',
  posthogProjectToken: FEATURES.POSTHOG ? process.env.POSTHOG_PROJECT_TOKEN || '' : '',
  // Use a SEPARATE dev bot here (BotFather), never the prod bot: Telegram
  // rejects getUpdates polling while a webhook is registered on the same bot.
  telegramBotToken: FEATURES.TELEGRAM ? process.env.TELEGRAM_BOT_TOKEN || '' : '',
  telegramWebhookSecret: FEATURES.TELEGRAM ? process.env.TELEGRAM_WEBHOOK_SECRET || '' : '',
  shouldRateLimit: true,
  shouldMockThirdParties: false,
  shouldSlowDownApiRoutes: false,
  usersWithFreeAccess: parseEmails(process.env.USERS_WITH_FREE_ACCESS || '').validEmails,
  emailsOfTestUsers: parseEmails(process.env.EMAILS_OF_TEST_USERS || '').validEmails,
  devAutoSeedEmailPattern,
  devAutoSeedNativeLanguage,
  isGuestModeEnabled,
  maxSourcesPerGuest,
  featureFlags: {
    isCreditCardRequiredForAll: () => false,
    shouldAppBeFreeForEveryone: () => true,
  },
}

const developmentTunnelConfig: EnvironmentConfig = {
  ...developmentConfig,
  port: 4002,
  webUrl: process.env.WEB_URL || '',
  allowedCorsOrigins: [process.env.WEB_URL || '', ...extensionOrigins],
  // Uses JWKS endpoint from local Supabase (supabase-dev-tunnel)
  supabaseJwksUri: 'http://127.0.0.1:34321/auth/v1/.well-known/jwks.json',
  supabaseConnectionString: 'postgresql://postgres:postgres@127.0.0.1:34322/postgres',
  // shown by `yarn db:dev:tunnel` command
  supabaseProjectUrl: 'http://127.0.0.1:34321',
  // Secret API key generated by Supabase with signing keys (stable, tied to signing_key.json)
  supabaseSecretKey: 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz',
}

const developmentWithoutThirdPartiesConfig: EnvironmentConfig = {
  ...developmentConfig,
  shouldMockThirdParties: true,
  shouldSlowDownApiRoutes: false,
  telegramBotToken: 'dummyTelegramBotToken',
  telegramWebhookSecret: 'dummyTelegramWebhookSecret',
}

const developmentWithoutThirdPartiesTunnelConfig: EnvironmentConfig = {
  ...developmentWithoutThirdPartiesConfig,
  webUrl: process.env.WEB_URL || '',
  allowedCorsOrigins: [process.env.WEB_URL || '', ...extensionOrigins],
  supabaseConnectionString: 'postgresql://postgres:postgres@127.0.0.1:34322/postgres',
}

const testConfig: EnvironmentConfig = {
  environmentName: 'test',
  port: 1,
  webUrl: 'some-web-url',
  shouldLogRequests: false,
  allowedCorsOrigins: ['some-web-url', ...extensionOrigins],
  resendApiKey: 'dummyResendApiKey',
  anthropicApiKey: 'dummyAnthropicApiKey',
  tmdbApiKey: 'dummyTmdbApiKey',
  openSubtitlesApiKey: 'dummyOpenSubtitlesApiKey',
  openSubtitlesUserAgent: 'dummyOpenSubtitlesUserAgent',
  stripeSecretKey: FEATURES.STRIPE ? 'dummyStripeSecretKey' : '',
  stripeWebhookSecret: FEATURES.STRIPE ? 'dummyStripeWebhookSecret' : '',
  stripeMonthlyPriceInEurId: FEATURES.STRIPE ? 'dummyStripeMonthlyPriceInEurId' : '',
  stripeYearlyPriceInEurId: FEATURES.STRIPE ? 'dummyStripeYearlyPriceInEurId' : '',
  // Tests use JWKS endpoint from local Supabase (supabase-test)
  // shown by `yarn db:test` command
  supabaseJwksUri: 'http://127.0.0.1:64321/auth/v1/.well-known/jwks.json',
  supabaseConnectionString: 'postgresql://postgres:postgres@127.0.0.1:64322/postgres',
  // shown by `yarn db:test` command
  supabaseProjectUrl: 'http://127.0.0.1:64321',
  // Secret API key generated by Supabase with signing keys (stable, tied to signing_key.json)
  supabaseSecretKey: 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz',
  revenuecatApiKey: FEATURES.REVENUECAT ? 'dummyRevenuecatApiKey' : '',
  revenuecatProjectId: FEATURES.REVENUECAT ? 'dummyRevenuecatProjectId' : '',
  revenuecatWebhookAuthHeader: FEATURES.REVENUECAT ? 'dummyRevenuecatWebhookAuthHeader' : '',
  // empty on purpose: an empty token keeps the PostHog client a no-op in tests
  posthogProjectToken: '',
  telegramBotToken: FEATURES.TELEGRAM ? 'dummyTelegramBotToken' : '',
  telegramWebhookSecret: FEATURES.TELEGRAM ? 'dummyTelegramWebhookSecret' : '',
  shouldRateLimit: false,
  shouldMockThirdParties: true,
  shouldSlowDownApiRoutes: false,
  usersWithFreeAccess: [],
  emailsOfTestUsers: [],
  devAutoSeedEmailPattern: null,
  devAutoSeedNativeLanguage: 'fr',
  // Integration tests toggle the flag per-app through AppDependencies instead
  // of this static config.
  isGuestModeEnabled: false,
  // Static: the quota guard only fires for users flagged is_anonymous in
  // auth.users, so regular test fixtures never hit it.
  maxSourcesPerGuest: 3,
  featureFlags: {
    isCreditCardRequiredForAll: () => false,
    shouldAppBeFreeForEveryone: () => true,
  },
}

let environmentConfig: EnvironmentConfig
export const getConfig = (): EnvironmentConfig => {
  if (!environmentConfig) {
    if (isProduction()) {
      environmentConfig = productionConfig
    } else if (isDevelopment()) {
      environmentConfig = developmentConfig
    } else if (isDevelopmentTunnel()) {
      environmentConfig = developmentTunnelConfig
    } else if (isDevelopmentWithoutThirdParties()) {
      environmentConfig = developmentWithoutThirdPartiesConfig
    } else if (isDevelopmentWithoutThirdPartiesTunnel()) {
      environmentConfig = developmentWithoutThirdPartiesTunnelConfig
    } else if (isTest()) {
      environmentConfig = testConfig
    } else {
      throw Error(`There is no config for environment: ${getEnvironmentName()}`)
    }
  }
  return environmentConfig
}
