import * as Sentry from '@sentry/node'
import { nodeProfilingIntegration } from '@sentry/profiling-node'
import { FEATURES } from '@template-app/core/features'
import { getConfig } from '../../../config/environment-config'

const globalWithDebugFlag = globalThis as typeof globalThis & {
  __SENTRY_DEBUG__?: boolean
}

// Ensure the SDK runs in non-debug mode unless explicitly overridden.
if (typeof globalWithDebugFlag.__SENTRY_DEBUG__ === 'undefined') {
  globalWithDebugFlag.__SENTRY_DEBUG__ = false
}

const config = getConfig()

if (FEATURES.SENTRY) {
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.environmentName,
    ...config.sentry.options,
    integrations: [nodeProfilingIntegration()],
  })
}
