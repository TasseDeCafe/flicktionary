import posthog from 'posthog-js'
import { FEATURES } from '@template-app/core/features'
import { PlanType } from '@/app/[lang]/(components)/(pricing)/pricing-section'

const defaultProperties = () => ({
  href: window.location.href,
  path_name: window.location.pathname,
  hash: window.location.hash,
  path_and_hash: window.location.pathname + window.location.hash,
  domain: window.location.hostname,
})

const captureWithDefaults = (eventName: string, properties: Record<string, string> = {}) => {
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
}
