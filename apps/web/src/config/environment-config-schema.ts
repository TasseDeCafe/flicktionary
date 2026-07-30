import { z } from 'zod'
import { FEATURES } from '@flicktionary/core/features'

export const environmentConfigSchema = z.object({
  environmentName: z.string(),
  apiHost: z.url(),
  webUrl: z.url(),
  domain: z.string(),
  supabaseProjectUrl: z.url(),
  supabasePublishableKey: z.string().min(1),
  posthogProjectToken: FEATURES.POSTHOG ? z.string() : z.string().max(0),
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
