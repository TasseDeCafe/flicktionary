import { z } from 'zod'
import { FEATURES } from '@template-app/core/features'

const sentrySampleRate = z.number().min(0).max(1)

const sentryOptionsSchema = z.object({
  maxValueLength: z.number().int().positive(),
  tracesSampleRate: sentrySampleRate,
  replaysSessionSampleRate: sentrySampleRate,
  replaysOnErrorSampleRate: sentrySampleRate,
})

const sentrySchema = FEATURES.SENTRY
  ? z.object({ dsn: z.string().min(1), options: sentryOptionsSchema })
  : z.object({ dsn: z.string(), options: sentryOptionsSchema })

export const environmentConfigSchema = z.object({
  environmentName: z.string(),
  domain: z.string(),
  webUrl: z.url(),
  landingPageUrl: z.url(),
  posthogToken: FEATURES.POSTHOG ? z.string().min(1) : z.string(),
  sentry: sentrySchema,
  featureFlags: z.object({
    isCreditCardRequiredForAll: z.function({
      input: [],
      output: z.boolean(),
    }),
    shouldInformAboutIosNativeApp: z.function({
      input: [],
      output: z.boolean(),
    }),
    shouldInformAboutAndroidNativeApp: z.function({
      input: [],
      output: z.boolean(),
    }),
  }),
})
