import { FEATURES } from '@template-app/core/features'
import { getConfig } from '@/config/environment-config'

export const initializePosthog = async () => {
  if (!FEATURES.POSTHOG) return
  if (getConfig().posthogToken) {
    const posthog = (await import('posthog-js')).default
    posthog.init(getConfig().posthogToken, {
      api_host: 'https://eu.i.posthog.com',
      persistence: 'localStorage+cookie',
    })

    const url = new URL(window.location.href)
    const urlParams = new URLSearchParams(url.search)
    const utmParams = {
      utm_source: urlParams.get('utm_source'),
      utm_medium: urlParams.get('utm_medium'),
      utm_campaign: urlParams.get('utm_campaign'),
      utm_term: urlParams.get('utm_term'),
      utm_content: urlParams.get('utm_content'),
    }

    const filteredUtmParamsWithoutNullValues = Object.fromEntries(
      Object.entries(utmParams).filter(([, value]) => value !== null)
    )

    // we capture the utm params explicitly here because posthog's auto capture might not capture them
    // before they're stripped from the url
    posthog.capture('$pageview', {
      ...filteredUtmParamsWithoutNullValues,
      $current_url: url.href,
    })
  }
}
