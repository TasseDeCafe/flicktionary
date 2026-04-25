import { z } from 'zod'
import { FEATURES } from '@template-app/core/features'
import { getModeName, isDevelopment, isDevelopmentTunnel, isProduction, isTest } from './environment-utils'
import { environmentConfigSchema } from './environment-config-schema'

type EnvironmentConfig = z.infer<typeof environmentConfigSchema>

const getProductionConfig = (): EnvironmentConfig => ({
  environmentName: 'production',
  domain: 'app-monorepo-template.dev',
  webUrl: 'https://app.app-monorepo-template.dev',
  landingPageUrl: 'https://www.app-monorepo-template.dev',
  posthogToken: FEATURES.POSTHOG ? process.env.NEXT_PUBLIC_POSTHOG_TOKEN || '' : '',
  sentry: FEATURES.SENTRY
    ? {
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',
        options: {
          maxValueLength: 8192,
          tracesSampleRate: 1.0,
          replaysSessionSampleRate: 1.0,
          replaysOnErrorSampleRate: 1.0,
        },
      }
    : {
        dsn: '',
        options: {
          maxValueLength: 8192,
          tracesSampleRate: 0,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
        },
      },
  featureFlags: {
    isCreditCardRequiredForAll: () => true,
    shouldInformAboutIosNativeApp: () => true,
    shouldInformAboutAndroidNativeApp: () => true,
  },
})

const getDevelopmentConfig = (): EnvironmentConfig => ({
  environmentName: 'development',
  domain: 'localhost',
  webUrl: 'http://localhost:5174',
  landingPageUrl: 'http://localhost:3000',
  posthogToken: FEATURES.POSTHOG ? process.env.NEXT_PUBLIC_POSTHOG_TOKEN || '' : '',
  sentry: FEATURES.SENTRY
    ? {
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',
        options: {
          maxValueLength: 8192,
          tracesSampleRate: 1.0,
          // todo: you might want to set this lower.
          replaysSessionSampleRate: 1.0,
          replaysOnErrorSampleRate: 1.0,
        },
      }
    : {
        dsn: '',
        options: {
          maxValueLength: 8192,
          tracesSampleRate: 0,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
        },
      },
  featureFlags: {
    isCreditCardRequiredForAll: () => true,
    shouldInformAboutIosNativeApp: () => true,
    shouldInformAboutAndroidNativeApp: () => true,
  },
})

const getDevelopmentTunnelConfig = (): EnvironmentConfig => ({
  ...getDevelopmentConfig(),
  domain: 'app-monorepo-template.dev',
  environmentName: 'development-tunnel',
  webUrl: process.env.NEXT_PUBLIC_WEB_URL_TUNNEL || '',
  landingPageUrl: process.env.NEXT_PUBLIC_LANDING_PAGE_URL_TUNNEL || '',
  posthogToken: FEATURES.POSTHOG ? process.env.NEXT_PUBLIC_POSTHOG_TOKEN || '' : '',
})

const getTestConfig = (): EnvironmentConfig => ({
  environmentName: 'test',
  webUrl: 'http://localhost:5173',
  landingPageUrl: 'localhost:3000',
  posthogToken: '',
  sentry: FEATURES.SENTRY
    ? {
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',
        options: {
          maxValueLength: 8192,
          tracesSampleRate: 1.0,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
        },
      }
    : {
        dsn: '',
        options: {
          maxValueLength: 8192,
          tracesSampleRate: 0,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
        },
      },
  featureFlags: {
    isCreditCardRequiredForAll: () => true,
    shouldInformAboutIosNativeApp: () => true,
    shouldInformAboutAndroidNativeApp: () => true,
  },
  domain: 'some-domain',
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
