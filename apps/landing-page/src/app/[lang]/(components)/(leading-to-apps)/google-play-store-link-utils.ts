import { EXTERNAL_LINKS } from '@template-app/core/constants/external-links'

export const buildAndroidPlayStoreLink = (): string => {
  const referral = localStorage.getItem('referral') || ''
  const utm_source = localStorage.getItem('utm_source') || ''
  const utm_campaign = localStorage.getItem('utm_campaign') || ''
  const utm_medium = localStorage.getItem('utm_medium') || ''
  const utm_content = localStorage.getItem('utm_content') || ''
  const utm_term = localStorage.getItem('utm_term') || ''

  const params: string[] = []

  if (utm_source) {
    params.push(`utm_source=${encodeURIComponent(utm_source)}`)
  }
  if (utm_medium) {
    params.push(`utm_medium=${encodeURIComponent(utm_medium)}`)
  }
  if (utm_campaign) {
    params.push(`utm_campaign=${encodeURIComponent(utm_campaign)}`)
  }
  if (utm_term) {
    params.push(`utm_term=${encodeURIComponent(utm_term)}`)
  }
  if (utm_content) {
    params.push(`utm_content=${encodeURIComponent(utm_content)}`)
  }
  if (referral) {
    params.push(`referral=${encodeURIComponent(referral)}`)
  }

  // If no parameters, return the base URL
  if (params.length === 0) {
    return EXTERNAL_LINKS.ANDROID_GOOGLE_PLAY_URL
  }

  // Join parameters and URL encode the entire referrer string
  const referrerString = encodeURIComponent(params.join('&'))
  return `${EXTERNAL_LINKS.ANDROID_GOOGLE_PLAY_URL}&referrer=${referrerString}`
}
