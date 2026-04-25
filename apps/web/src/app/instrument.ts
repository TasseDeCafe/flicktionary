import * as Sentry from '@sentry/react'
import { FEATURES } from '@template-app/core/features'
import { getConfig } from '@/config/environment-config.ts'

const getSentryEnvironment = (configEnvironment: string): string => {
  switch (configEnvironment) {
    case 'development':
    case 'development-tunnel':
      return 'development'
    default:
      return configEnvironment
  }
}

const config = getConfig()

if (FEATURES.SENTRY && config.sentry.dsn) {
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: getSentryEnvironment(config.environmentName),
    ...config.sentry.options,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
        networkDetailAllowUrls: config.sentry.options.networkDetailAllowUrls,
        networkRequestHeaders: config.sentry.options.networkRequestHeaders,
        networkResponseHeaders: config.sentry.options.networkResponseHeaders,
      }),
    ],
  })
}
