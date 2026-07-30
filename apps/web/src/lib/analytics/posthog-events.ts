import posthog from 'posthog-js'
import { isPostHogEnabled } from '@/lib/analytics/posthog-init'

const capture = (eventName: string, properties: Record<string, string> = {}) => {
  if (!isPostHogEnabled()) return
  posthog.capture(eventName, properties)
}

// Curated custom events only: generic clicks and page/overlay views are
// already covered by PostHog's $autocapture and $pageview.
// Use snake_case names, past-tense verbs (modal_opened, not modal_open):
// https://posthog.com/docs/getting-started/send-events#naming-your-custom-events
export const POSTHOG_EVENTS = {
  magicLinkFailureOrExpiration: () => {
    capture('magic_link_failure_or_expiration')
  },
  noTokenHashProvided: () => {
    capture('no_token_hash_provided')
  },
  showPaywallToUser: () => {
    capture('show_paywall_to_user')
  },
  rateLimitUser: () => {
    capture('rate_limit_user')
  },
  invalidTokenError: () => {
    capture('invalid_token_error')
  },
}
