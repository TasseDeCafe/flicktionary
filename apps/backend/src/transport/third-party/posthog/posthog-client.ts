import { PostHog } from 'posthog-node'
import { FEATURES } from '@flicktionary/core/features'
import { getConfig } from '../../../config/environment-config'

const POSTHOG_HOST = 'https://eu.i.posthog.com'

const noopClient = {
  capture: () => {},
  captureException: () => {},
  shutdown: async () => {},
} as unknown as PostHog

// An empty token disables PostHog entirely: automated tests and Railway
// PR/ephemeral previews simply don't define POSTHOG_PROJECT_TOKEN.
export const isPosthogEnabled = (): boolean => FEATURES.POSTHOG && Boolean(getConfig().posthogProjectToken)

const createPosthogClient = (): PostHog => {
  if (!isPosthogEnabled()) return noopClient
  return new PostHog(getConfig().posthogProjectToken, {
    host: POSTHOG_HOST,
    enableExceptionAutocapture: true,
  })
}

export const posthogClient = createPosthogClient()

export const shutdownPosthogClient = async (): Promise<void> => {
  try {
    await posthogClient.shutdown()
  } catch (error) {
    console.warn('Failed to shutdown PostHog client gracefully', error)
  }
}
