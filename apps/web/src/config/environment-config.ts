import { z } from 'zod'
import { FEATURES } from '@template-app/core/features'
import { getModeName, isDevelopment, isDevelopmentTunnel, isProduction, isTest } from './environment-utils.ts'
import { environmentConfigSchema } from './environment-config-schema.ts'
import { parseHashedEmails } from './environment-config-utils.ts'

export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>

const getProductionConfig = (): EnvironmentConfig => ({
  environmentName: 'production',
  apiHost: import.meta.env.VITE_API_HOST,
  webUrl: 'https://app.app-monorepo-template.dev',
  domain: 'app-monorepo-template.dev',
  landingPageUrl: import.meta.env.VITE_LANDING_PAGE_URL,
  supabaseProjectUrl: import.meta.env.VITE_SUPABASE_PROJECT_URL,
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  sentry: FEATURES.SENTRY
    ? {
        dsn: import.meta.env.VITE_SENTRY_DSN,
        options: {
          maxValueLength: 8192,
          tracesSampleRate: 1.0,
          replaysSessionSampleRate: 0.1,
          replaysOnErrorSampleRate: 1.0,
          networkDetailAllowUrls: [`${import.meta.env.VITE_API_HOST}/api/v1/*`],
          networkRequestHeaders: ['X-Custom-Header'],
          networkResponseHeaders: ['X-Custom-Header'],
        },
      }
    : {
        dsn: '',
        options: {
          maxValueLength: 8192,
          tracesSampleRate: 0,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
          networkDetailAllowUrls: [],
          networkRequestHeaders: [],
          networkResponseHeaders: [],
        },
      },
  posthogToken: FEATURES.POSTHOG ? import.meta.env.VITE_POSTHOG_TOKEN : '',
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
  landingPageUrl: 'http://localhost:3000',
  // shown by `supabase start` command
  supabaseProjectUrl: 'http://127.0.0.1:54321',
  // shown by `supabase start` command
  supabasePublishableKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  sentry: FEATURES.SENTRY
    ? {
        dsn: import.meta.env.VITE_SENTRY_DSN,
        options: {
          maxValueLength: 8192,
          tracesSampleRate: 1.0,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
          networkDetailAllowUrls: [`${import.meta.env.VITE_API_HOST}/api/v1/*`],
          networkRequestHeaders: ['X-Custom-Header'],
          networkResponseHeaders: ['X-Custom-Header'],
        },
      }
    : {
        dsn: '',
        options: {
          maxValueLength: 8192,
          tracesSampleRate: 0,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
          networkDetailAllowUrls: [],
          networkRequestHeaders: [],
          networkResponseHeaders: [],
        },
      },
  posthogToken: FEATURES.POSTHOG ? import.meta.env.VITE_POSTHOG_TOKEN || '' : '',
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
  domain: 'app-monorepo-template.dev',
  environmentName: 'development-tunnel',
  apiHost: import.meta.env.VITE_API_HOST,
  landingPageUrl: import.meta.env.VITE_LANDING_PAGE_URL,
  supabaseProjectUrl: import.meta.env.VITE_SUPABASE_PROJECT_URL,
})

const getTestConfig = (): EnvironmentConfig => ({
  environmentName: 'test',
  apiHost: 'no-host-because-it-is-a-test',
  webUrl: 'no-web-url-because-it-is-a-test',
  domain: 'some-domain',
  landingPageUrl: 'some-landing-page-url',
  supabaseProjectUrl: 'dummy-supabase-project-url',
  supabasePublishableKey: 'dummy-supabase-project-key',
  sentry: {
    dsn: 'dummySentryDsn',
    options: {
      maxValueLength: 8192,
      tracesSampleRate: 1.0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      networkDetailAllowUrls: [],
      networkRequestHeaders: [],
      networkResponseHeaders: [],
    },
  },
  posthogToken: '',
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
