import { PostHog } from 'posthog-react-native'
import { FEATURES } from '@flicktionary/core/features'
import { getConfig } from '@/config/environment-config'

// https://posthog.com/docs/libraries/react-native
// An empty token keeps native PostHog disabled: native enablement (SDK
// update, replay config) is deliberate later work — see issue #330.
export const posthog =
  FEATURES.POSTHOG && getConfig().posthogToken
    ? new PostHog(getConfig().posthogToken, {
        host: getConfig().posthogHost,
        enableSessionReplay: true,
      })
    : null
