import Constants, { ExecutionEnvironment } from 'expo-constants'
import { FEATURES } from '@template-app/core/features'
import { getModeName, isDevelopment, isProduction, isTest } from './environment-utils'
import { env, environmentConfigSchema } from './environment-config-schema'
import { z } from 'zod'
import { parseHashedEmails } from '@/config/environment-config-utils'

export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>

const getProductionConfig = (): EnvironmentConfig => ({
  environmentName: 'production',
  webUrl: 'https://app.app-monorepo-template.dev',
  apiHost: env.EXPO_PUBLIC_API_HOST_TUNNEL,
  supabaseProjectUrl: env.EXPO_PUBLIC_SUPABASE_PROJECT_URL_TUNNEL,
  supabasePublishableKey: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  googleClientId: FEATURES.GOOGLE_AUTH ? env.EXPO_PUBLIC_GOOGLE_CLIENT_ID : '',
  googleIosClientId: FEATURES.GOOGLE_AUTH ? env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID : '',
  revenueCatAppleApiKey: FEATURES.REVENUECAT ? env.EXPO_PUBLIC_REVENUE_CAT_APPLE_API_KEY : '',
  revenueCatGoogleApiKey: FEATURES.REVENUECAT ? env.EXPO_PUBLIC_REVENUE_CAT_GOOGLE_API_KEY : '',
  shouldLogLocally: false,
  shouldSkipRevenueCatPaywall: !FEATURES.REVENUECAT,
  sentry: FEATURES.SENTRY
    ? {
        dsn: env.EXPO_PUBLIC_SENTRY_DSN,
        options: {
          attachScreenshot: true,
          tracesSampleRate: 1.0,
          profilesSampleRate: 1.0,
          maxValueLength: 8192,
          enableNativeFramesTracking: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
          replaysSessionSampleRate: 0.1,
          replaysOnErrorSampleRate: 1.0,
        },
      }
    : {
        dsn: '',
        options: {
          attachScreenshot: false,
          tracesSampleRate: 0,
          profilesSampleRate: 0,
          maxValueLength: 8192,
          enableNativeFramesTracking: false,
        },
      },
  shouldCheckForEasUpdates: true,
  hashedEmailsOfTestUsers: parseHashedEmails(env.EXPO_PUBLIC_HASHED_EMAILS_OF_TEST_USERS),
  // https://us.posthog.com/project/69989/settings/project
  posthogToken: FEATURES.POSTHOG ? env.EXPO_PUBLIC_POSTHOG_TOKEN : '',
  posthogHost: FEATURES.POSTHOG ? 'https://eu.i.posthog.com' : '',
})

const getDevelopmentConfig = (): EnvironmentConfig => ({
  environmentName: 'development',
  webUrl: env.EXPO_PUBLIC_WEB_URL_TUNNEL,
  apiHost: env.EXPO_PUBLIC_API_HOST_TUNNEL,
  supabaseProjectUrl: env.EXPO_PUBLIC_SUPABASE_PROJECT_URL_TUNNEL,
  supabasePublishableKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  googleClientId: FEATURES.GOOGLE_AUTH ? env.EXPO_PUBLIC_GOOGLE_CLIENT_ID : '',
  googleIosClientId: FEATURES.GOOGLE_AUTH ? env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID : '',
  revenueCatAppleApiKey: FEATURES.REVENUECAT ? env.EXPO_PUBLIC_REVENUE_CAT_APPLE_API_KEY : '',
  revenueCatGoogleApiKey: FEATURES.REVENUECAT ? env.EXPO_PUBLIC_REVENUE_CAT_GOOGLE_API_KEY : '',
  shouldLogLocally: true,
  shouldSkipRevenueCatPaywall: !FEATURES.REVENUECAT,
  sentry: FEATURES.SENTRY
    ? {
        dsn: env.EXPO_PUBLIC_SENTRY_DSN,
        options: {
          attachScreenshot: false,
          tracesSampleRate: 0,
          profilesSampleRate: 0,
          maxValueLength: 8192,
          enableNativeFramesTracking: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
        },
      }
    : {
        dsn: '',
        options: {
          attachScreenshot: false,
          tracesSampleRate: 0,
          profilesSampleRate: 0,
          maxValueLength: 8192,
          enableNativeFramesTracking: false,
        },
      },
  shouldCheckForEasUpdates: false,
  hashedEmailsOfTestUsers: parseHashedEmails(env.EXPO_PUBLIC_HASHED_EMAILS_OF_TEST_USERS || ''),
  // https://us.posthog.com/project/88845/settings/project
  posthogToken: FEATURES.POSTHOG ? env.EXPO_PUBLIC_POSTHOG_TOKEN : '',
  posthogHost: FEATURES.POSTHOG ? 'https://eu.i.posthog.com' : '',
})

const getTestConfig = (): EnvironmentConfig => ({
  environmentName: 'test',
  webUrl: 'http://dummy-web-url.com',
  apiHost: 'dummy-api-host',
  supabaseProjectUrl: 'http://dummy-supabase-url.com',
  supabasePublishableKey: 'dummy-key',
  googleClientId: FEATURES.GOOGLE_AUTH ? 'dummy-google-client-id' : '',
  googleIosClientId: FEATURES.GOOGLE_AUTH ? 'dummy-google-ios-client-id' : '',
  revenueCatAppleApiKey: FEATURES.REVENUECAT ? 'dummy-revenue-cat-apple-api-key' : '',
  revenueCatGoogleApiKey: FEATURES.REVENUECAT ? 'dummy-revenue-cat-google-api-key' : '',
  shouldLogLocally: true,
  shouldSkipRevenueCatPaywall: !FEATURES.REVENUECAT,
  sentry: FEATURES.SENTRY
    ? {
        dsn: 'dummy-sentry-dsn',
        options: {
          attachScreenshot: false,
          tracesSampleRate: 0,
          profilesSampleRate: 0,
          maxValueLength: 8192,
          enableNativeFramesTracking: false,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
        },
      }
    : {
        dsn: '',
        options: {
          attachScreenshot: false,
          tracesSampleRate: 0,
          profilesSampleRate: 0,
          maxValueLength: 8192,
          enableNativeFramesTracking: false,
        },
      },
  shouldCheckForEasUpdates: false,
  hashedEmailsOfTestUsers: ['dummy-hashed-email-1', 'dummy-hashed-email-2'],
  posthogToken: FEATURES.POSTHOG ? 'dummy-posthog-token' : '',
  posthogHost: FEATURES.POSTHOG ? 'dummy-posthog-host' : '',
})

let config: EnvironmentConfig | null = null

export const getConfig = (): EnvironmentConfig => {
  if (!config) {
    if (isProduction()) {
      config = getProductionConfig()
    } else if (isDevelopment()) {
      config = getDevelopmentConfig()
    } else if (isTest()) {
      config = getTestConfig()
    } else {
      throw Error(`There is no config for environment: ${getModeName()}`)
    }
  }
  return config
}
