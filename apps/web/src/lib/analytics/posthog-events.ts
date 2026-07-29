import posthog from 'posthog-js'
import { FEATURES } from '@flicktionary/core/features'

import { PlanType } from '@flicktionary/api-client/orpc-contracts/billing-contract'

const defaultProperties = () => ({
  href: window.location.href,
  path_name: window.location.pathname,
  hash: window.location.hash,
  path_and_hash: window.location.pathname + window.location.hash,
  domain: window.location.hostname,
})

const captureWithDefaults = (eventName: string, properties: Record<string, string | number | boolean> = {}) => {
  if (!FEATURES.POSTHOG) return
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
    captureWithDefaults('click', { click_name: clickName, plan_type: planType ?? '' })
  },
  viewPage: () => {
    captureWithDefaults('page_view')
  },
  viewOverlay: (modalId: string) => {
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
  onboardingCompleted: () => {
    captureWithDefaults('onboarding_completed')
  },
  sessionCreated: (props: { content_type: string; target_language: string; already_existed: boolean }) => {
    captureWithDefaults('session_created', props)
  },
  practiceLanguageSelected: (targetLanguage: string) => {
    captureWithDefaults('practice_language_selected', { target_language: targetLanguage })
  },
  practiceExplainerDismissed: () => {
    captureWithDefaults('practice_explainer_dismissed')
  },
  practiceSessionCompleted: (props: { copy_variant: string; correct_count: number; total_count: number }) => {
    captureWithDefaults('practice_session_completed', props)
  },
  sessionRecapCompleted: (props: { correct_count: number; total_count: number }) => {
    captureWithDefaults('session_recap_completed', props)
  },
  vocabularyTermSaved: (props: { target_language: string }) => {
    captureWithDefaults('vocabulary_term_saved', props)
  },
  subscriptionActivated: () => {
    captureWithDefaults('subscription_activated')
  },
  paywallDismissed: () => {
    captureWithDefaults('paywall_dismissed')
  },
  signOut: () => {
    captureWithDefaults('sign_out')
  },
}
