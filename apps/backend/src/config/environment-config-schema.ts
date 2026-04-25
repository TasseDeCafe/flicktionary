import { z } from 'zod'
import { FEATURES } from '@template-app/core/features'

const sentrySampleRate = z.number().min(0).max(1)

const sentryOptionsSchema = z.object({
  maxValueLength: z.number().int().positive(),
  tracesSampleRate: sentrySampleRate,
  profilesSampleRate: sentrySampleRate,
  tracePropagationTargets: z.array(z.url()),
})

const sentrySchema = FEATURES.SENTRY
  ? z.object({ dsn: z.string().min(1), options: sentryOptionsSchema })
  : z.object({ dsn: z.string(), options: sentryOptionsSchema })

export const environmentConfigSchema = z.object({
  environmentName: z.string(),
  port: z.number().min(1).max(65535),
  webUrl: z.url(),
  allowedCorsOrigins: z.array(z.union([z.string(), z.instanceof(RegExp)])).min(1),
  // https://resend.com/api-keys
  resendApiKey: z.string().min(1),
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
  posthogApiKey: FEATURES.POSTHOG ? z.string().min(1) : z.string(),
  shouldLogRequests: z.boolean(),
  sentry: sentrySchema,
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
