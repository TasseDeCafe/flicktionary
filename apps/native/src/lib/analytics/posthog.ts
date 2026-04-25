import { PostHog } from 'posthog-react-native'
import { FEATURES } from '@template-app/core/features'
import { getConfig } from '@/config/environment-config'

// https://posthog.com/docs/libraries/react-native
export const posthog = FEATURES.POSTHOG
  ? new PostHog(getConfig().posthogToken, {
      host: getConfig().posthogHost,
      enableSessionReplay: true,
    })
  : null
