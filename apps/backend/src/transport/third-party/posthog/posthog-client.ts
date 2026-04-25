import { PostHog } from 'posthog-node'
import { FEATURES } from '@template-app/core/features'
import { getConfig } from '../../../config/environment-config'

const POSTHOG_HOST = 'https://eu.i.posthog.com'

const noopClient = {
  capture: () => {},
  shutdown: async () => {},
  shutdownAsync: async () => {},
} as unknown as PostHog

const createPosthogClient = (): PostHog => {
  if (!FEATURES.POSTHOG) return noopClient
  const config = getConfig()
  return new PostHog(config.posthogApiKey, {
    host: POSTHOG_HOST,
    enableExceptionAutocapture: true,
  })
}

export const posthogClient = createPosthogClient()

let hasRegisteredShutdownHandlers = false

const shutdownPosthogClient = async (): Promise<void> => {
  try {
    await posthogClient.shutdown()
  } catch (error) {
    console.warn('Failed to shutdown PostHog client gracefully', error)
  }
}

export const registerPosthogShutdownHandlers = (): void => {
  if (hasRegisteredShutdownHandlers) {
    return
  }

  hasRegisteredShutdownHandlers = true

  process.once('beforeExit', () => {
    void shutdownPosthogClient()
  })
  ;['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.once(signal as NodeJS.Signals, () => {
      void shutdownPosthogClient()
    })
  })
}
