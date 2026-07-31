import { z } from 'zod'
import { FEATURES } from '@flicktionary/core/features'

export const environmentConfigSchema = z.object({
  environmentName: z.string(),
  port: z.number().min(1).max(65535),
  webUrl: z.url(),
  allowedCorsOrigins: z.array(z.union([z.string(), z.instanceof(RegExp)])).min(1),
  // https://resend.com/api-keys
  resendApiKey: z.string().min(1),
  anthropicApiKey: z.string().min(1),
  tmdbApiKey: z.string().min(1),
  openSubtitlesApiKey: z.string().min(1),
  openSubtitlesUserAgent: z.string().min(1),
  stripeSecretKey: FEATURES.STRIPE ? z.string().min(1) : z.string(),
  stripeWebhookSecret: FEATURES.STRIPE ? z.string().min(1) : z.string(),
  stripeMonthlyPriceInEurId: FEATURES.STRIPE ? z.string().min(1) : z.string(),
  stripeYearlyPriceInEurId: FEATURES.STRIPE ? z.string().min(1) : z.string(),
  // https://app.revenuecat.com/projects/da60432b/api-keys
  revenuecatApiKey: FEATURES.REVENUECAT ? z.string().min(1) : z.string(),
  // https://app.revenuecat.com/projects/da60432b/settings
  revenuecatProjectId: FEATURES.REVENUECAT ? z.string().min(1) : z.string(),
  // https://app.revenuecat.com/projects/da60432b/integrations/webhooks
  revenuecatWebhookAuthHeader: FEATURES.REVENUECAT ? z.string().min(1) : z.string(),
  // https://core.telegram.org/bots#botfather
  telegramBotToken: FEATURES.TELEGRAM ? z.string().min(1) : z.string(),
  // Sent back by Telegram as X-Telegram-Bot-Api-Secret-Token on webhook calls
  telegramWebhookSecret: FEATURES.TELEGRAM ? z.string().min(1) : z.string(),
  // An empty token is valid: it disables PostHog at runtime (tests, previews)
  posthogProjectToken: FEATURES.POSTHOG ? z.string() : z.string().max(0),
  shouldLogRequests: z.boolean(),
  // Guest kill switch (GUEST_MODE_ENABLED in Doppler): when off, the backend
  // rejects JWTs carrying is_anonymous, locking out existing guest sessions
  // too. Supabase-side anonymous sign-ins stay permanently enabled; this flag
  // is the only thing ever toggled.
  isGuestModeEnabled: z.boolean(),
  // Captcha escalation lever (CAPTCHA_ENABLED + TURNSTILE_SITE_KEY in
  // Doppler): non-null tells the web app to fetch an invisible Turnstile
  // token before signInAnonymously. Mirrors the Supabase dashboard's captcha
  // toggle — flip both together, client side first (see the runbook in issue
  // #391). Independent from isGuestModeEnabled: that one is the nuclear
  // option that also locks out existing guest sessions; this one only adds
  // friction to creating new ones.
  captchaSiteKey: z.string().min(1).nullable(),
  // Cap on an anonymous (guest) user's source LIBRARY — the distinct
  // non-adhoc sources they hold a live session on — and on their live lesson
  // drafts (MAX_SOURCES_PER_GUEST in Doppler). Wallet protection: sources
  // feed the LLM enrichment pipeline and there is no other per-user quota.
  maxSourcesPerGuest: z.number().int().min(0),
  // Stale-guest cleanup sweep (ANON_CLEANUP_INTERVAL_DAYS /
  // ANON_RETENTION_DAYS in Doppler, defaults 7 / 30): sweep cadence and the
  // minimum age of a never-converted guest account before deletion.
  anonCleanupIntervalDays: z.number().int().positive(),
  anonRetentionDays: z.number().int().positive(),
  supabaseProjectUrl: z.string().min(1),
  supabaseSecretKey: z.string().min(1),
  // JWKS URI (asymmetric)
  // Format: https://<project_ref>.supabase.co/auth/v1/.well-known/jwks.json
  supabaseJwksUri: z.url(),
  supabaseConnectionString: z.string().min(1),
  shouldRateLimit: z.boolean(),
  shouldMockThirdParties: z.boolean(),
  shouldSlowDownApiRoutes: z.boolean(),
  usersWithFreeAccess: z.array(z.email()),
  // Emails of developers, collaborators, etc.
  emailsOfTestUsers: z.array(z.email()),
  // Optional regex matching dev/test emails: matching accounts skip the
  // onboarding gate and have native_language pre-seeded at signup.
  devAutoSeedEmailPattern: z.instanceof(RegExp).nullable(),
  // ISO 639-1 code used as the auto-seed default native_language for
  // matching emails. Must be set whenever devAutoSeedEmailPattern is set.
  devAutoSeedNativeLanguage: z.string(),
  featureFlags: z.object({
    // the two flags below should never be set to true at the same time, as it doesn't make sense
    isCreditCardRequiredForAll: z.function({
      input: [],
      output: z.boolean(),
    }),
    shouldAppBeFreeForEveryone: z.function({
      input: [],
      output: z.boolean(),
    }),
  }),
})

export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>
