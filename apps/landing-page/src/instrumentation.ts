import * as Sentry from '@sentry/nextjs'
import { FEATURES } from '@template-app/core/features'

export const register = async () => {
  if (!FEATURES.SENTRY) return

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

export const onRequestError = FEATURES.SENTRY ? Sentry.captureRequestError : undefined
