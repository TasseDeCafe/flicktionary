import { z } from 'zod'
import { FEATURES } from '@flicktionary/core/features'
import { getModeName, isDevelopment, isDevelopmentTunnel, isProduction, isTest } from './environment-utils.ts'
import { environmentConfigSchema } from './environment-config-schema.ts'
import { parseHashedEmails } from './environment-config-utils.ts'

export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>

// An empty token disables PostHog at runtime: Railway PR/ephemeral previews
// build in production mode but don't define VITE_POSTHOG_PROJECT_TOKEN, so
// they send nothing.
const getPosthogProjectToken = (): string => (FEATURES.POSTHOG ? import.meta.env.VITE_POSTHOG_PROJECT_TOKEN || '' : '')

const getProductionConfig = (): EnvironmentConfig => ({
  environmentName: 'production',
  apiHost: import.meta.env.VITE_API_HOST,
  webUrl: 'https://app.flicktionary.app',
  domain: 'flicktionary.app',
  supabaseProjectUrl: import.meta.env.VITE_SUPABASE_PROJECT_URL,
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  posthogProjectToken: getPosthogProjectToken(),
  shouldExcludeTestUsersFromAnalytics: true,
  shouldLogLocally: false,
  showDevTools: false,
  hashedEmailsOfTestUsers: parseHashedEmails(import.meta.env.VITE_HASHED_EMAILS_OF_TEST_USERS || ''),
  featureFlags: {
    isCreditCardRequiredForAll: () => true,
    shouldAppBeFreeForEveryone: () => false,
  },
})

const getDevelopmentConfig = (): EnvironmentConfig => ({
  environmentName: 'development',
  apiHost: 'http://localhost:4003',
  webUrl: 'http://localhost:5174',
  domain: 'localhost',
  // shown by `supabase start` command
  supabaseProjectUrl: 'http://127.0.0.1:54321',
  // shown by `supabase start` command
  supabasePublishableKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  posthogProjectToken: getPosthogProjectToken(),
  shouldExcludeTestUsersFromAnalytics: false,
  shouldLogLocally: true,
  showDevTools: false,
  hashedEmailsOfTestUsers: parseHashedEmails(import.meta.env.VITE_HASHED_EMAILS_OF_TEST_USERS || ''),
  featureFlags: {
    isCreditCardRequiredForAll: () => true,
    shouldAppBeFreeForEveryone: () => false,
  },
})

const getDevelopmentTunnelConfig = (): EnvironmentConfig => ({
  ...getDevelopmentConfig(),
  webUrl: import.meta.env.VITE_WEB_URL,
  domain: 'flicktionary.dev',
  environmentName: 'development-tunnel',
  apiHost: import.meta.env.VITE_API_HOST,
  supabaseProjectUrl: import.meta.env.VITE_SUPABASE_PROJECT_URL,
})

const getTestConfig = (): EnvironmentConfig => ({
  environmentName: 'test',
  apiHost: 'no-host-because-it-is-a-test',
  webUrl: 'no-web-url-because-it-is-a-test',
  domain: 'some-domain',
  supabaseProjectUrl: 'dummy-supabase-project-url',
  supabasePublishableKey: 'dummy-supabase-project-key',
  posthogProjectToken: '',
  shouldExcludeTestUsersFromAnalytics: false,
  shouldLogLocally: true,
  showDevTools: false,
  hashedEmailsOfTestUsers: [],
  featureFlags: {
    isCreditCardRequiredForAll: () => true,
    shouldAppBeFreeForEveryone: () => false,
  },
})

let config: EnvironmentConfig | null = null

export const getConfig = (): EnvironmentConfig => {
  if (!config) {
    if (isProduction()) {
      config = getProductionConfig()
    } else if (isDevelopment()) {
      config = getDevelopmentConfig()
    } else if (isDevelopmentTunnel()) {
      config = getDevelopmentTunnelConfig()
    } else if (isTest()) {
      config = getTestConfig()
    } else {
      throw Error(`There is no config for environment: ${getModeName()}`)
    }
  }
  return config
}
