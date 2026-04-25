import { z } from 'zod'
import { FEATURES } from '@template-app/core/features'

const sentrySampleRate = z.number().min(0).max(1)

const sentryOptionsSchema = z.object({
  maxValueLength: z.number().int().positive(),
  tracesSampleRate: sentrySampleRate,
  replaysSessionSampleRate: sentrySampleRate,
  replaysOnErrorSampleRate: sentrySampleRate,
  // Those parameters allow for logging request and response bodies
  networkDetailAllowUrls: z.array(z.string()),
  networkRequestHeaders: z.array(z.string()),
  networkResponseHeaders: z.array(z.string()),
})

const sentrySchema = FEATURES.SENTRY
  ? z.object({ dsn: z.string().min(1), options: sentryOptionsSchema })
  : z.object({ dsn: z.string(), options: sentryOptionsSchema })

export const environmentConfigSchema = z.object({
  environmentName: z.string(),
  apiHost: z.url(),
  webUrl: z.url(),
  domain: z.string(),
  landingPageUrl: z.url(),
  supabaseProjectUrl: z.url(),
  supabasePublishableKey: z.string().min(1),
  sentry: sentrySchema,
  posthogToken: FEATURES.POSTHOG ? z.string().min(1) : z.string(),
  shouldLogLocally: z.boolean(),
  showDevTools: z.boolean(),
  hashedEmailsOfTestUsers: z.array(z.string().min(1)),
  featureFlags: z.object({
    // means that all users have to introduce a credit card to get a free trial
    // the two flags should never be set to true at the same time, as it doesn't make sense
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
