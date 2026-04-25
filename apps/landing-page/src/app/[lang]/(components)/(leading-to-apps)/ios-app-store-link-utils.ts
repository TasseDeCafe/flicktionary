import { EXTERNAL_LINKS } from '@template-app/core/constants/external-links'

export const __buildIosAppStoreLink = (
  referral: string,
  utm_source: string,
  utm_campaign: string,
  utm_medium: string,
  utm_content: string,
  utm_term: string
): string => {
  // this url can be found on our App Store Connect
  // https://appstoreconnect.apple.com/analytics/app/d30/6741498422/acquisition/campaigns
  // read more about it here: https://developer.apple.com/help/app-store-connect/view-app-analytics/manage-campaigns
  const baseUrl = EXTERNAL_LINKS.IOS_APP_STORE_URL_WITH_PROVIDER_TOKEN_AND_MEDIUM_TYPE

  let ct: string
  if (referral !== '') {
    ct = referral
  } else {
    const hasNoUtmParams: boolean =
      utm_source === '' && utm_campaign === '' && utm_medium === '' && utm_content === '' && utm_term === ''
    if (hasNoUtmParams) {
      return `${EXTERNAL_LINKS.IOS_APP_STORE_URL_WITH_PROVIDER_TOKEN_AND_MEDIUM_TYPE}&ct=website|default|web||`
    }

    const utmParamsSortedByPriority = [
      utm_source || '',
      `|${utm_campaign || ''}`,
      `|${utm_medium || ''}`,
      `|${utm_content || ''}`,
      `|${utm_term || ''}`,
    ]

    ct = ''
    for (let i = 0; i < utmParamsSortedByPriority.length; i++) {
      const newCt = `${ct}${utmParamsSortedByPriority[i]}`

      // Apple's limit for ct params is 30 chars
      if (newCt.length > 30) {
        break
      }

      ct = newCt
    }
  }

  return `${baseUrl}&ct=${ct}`
}

export const buildIosAppStoreLink = (): string => {
  const referral = localStorage.getItem('referral') || ''
  const utm_source = localStorage.getItem('utm_source') || ''
  const utm_campaign = localStorage.getItem('utm_campaign') || ''
  const utm_medium = localStorage.getItem('utm_medium') || ''
  const utm_content = localStorage.getItem('utm_content') || ''
  const utm_term = localStorage.getItem('utm_term') || ''

  return __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)
}
