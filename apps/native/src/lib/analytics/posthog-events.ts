import { PlanType } from '@template-app/api-client/orpc-contracts/billing-contract'
import { FEATURES } from '@template-app/core/features'
import { Platform } from 'react-native'
import { posthog } from '@/lib/analytics/posthog'

const defaultProperties = () => ({
  platform: 'native',
  platform_os: Platform.OS,
})

const captureWithDefaults = (eventName: string, properties: Record<string, string> = {}) => {
  if (!FEATURES.POSTHOG || !posthog) return
  posthog.capture(eventName, { ...defaultProperties(), ...properties })
}

// use snake case for everything sent to posthog
// follow the conventions from here: https://posthog.com/docs/getting-started/send-events#naming-your-custom-events
// todo posthog: we should name events like modal_opened, modal_closed, not modal_view, modal_close
// we should not get crazy about this fix, it's fine to have some event names not following the conventions
// it might be quite a bit of work, we would have to go through all the dashboards and rename them
// for the new events we should use the correct convention
export const POSTHOG_EVENTS = {
  click: (clickName: string) => {
    captureWithDefaults('click', { click_name: clickName })
  },
  clickPlan: (clickName: string, planType: PlanType) => {
    captureWithDefaults('click_plan', { click_name: clickName, plan_type: planType ?? '' })
  },
  viewPage: () => {
    captureWithDefaults('page_view')
  },
  viewModal: (modalId: string) => {
    captureWithDefaults('modal_view', { modal_id: modalId })
  },
  magicLinkFailureOrExpiration: () => {
    captureWithDefaults('magic_link_failure_or_expiration')
  },
  noTokenHashProvided: () => {
    captureWithDefaults('no_token_hash_provided')
  },
  showPaywallToUser: () => {
    captureWithDefaults('show_paywall_to_user')
  },
  rateLimitUser: () => {
    captureWithDefaults('rate_limit_user')
  },
  invalidTokenError: () => {
    captureWithDefaults('invalid_token_error')
  },
  planPurchased: () => {
    captureWithDefaults('plan_purchased', {})
  },
  forceUserToDownloadUpdateFromStore: () => {
    captureWithDefaults('force_user_to_download_update', {})
  },
  updateFromAppStoreFailed: () => {
    captureWithDefaults('update_from_app_store_failed', {})
  },
  startSilentOverTheAirUpdate: () => {
    captureWithDefaults('start_silent_over_the_air_update')
  },
  silentOverTheAirUpdateFetched: () => {
    captureWithDefaults('silent_over_the_air_update_fetched')
  },
  silentOverTheAirUpdateFailed: () => {
    captureWithDefaults('silent_over_the_air_update_failed')
  },
}
