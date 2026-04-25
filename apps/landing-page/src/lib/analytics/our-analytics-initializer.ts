import { localStorageWrapper } from '@/lib/storage/local-storage'

export const initializeOurAnalytics = () => {
  const url = new URL(window.location.href)
  const urlParams = new URLSearchParams(url.search)

  const utmSource = urlParams.get('utm_source')
  const utmMedium = urlParams.get('utm_medium')
  const utmCampaign = urlParams.get('utm_campaign')
  const utmTerm = urlParams.get('utm_term')
  const utmContent = urlParams.get('utm_content')

  if (utmSource && !localStorageWrapper.getUtmSource()) {
    localStorageWrapper.setUtmSource(utmSource)
  }
  if (utmMedium && !localStorageWrapper.getUtmMedium()) {
    localStorageWrapper.setUtmMedium(utmMedium)
  }
  if (utmCampaign && !localStorageWrapper.getUtmCampaign()) {
    localStorageWrapper.setUtmCampaign(utmCampaign)
  }
  if (utmTerm && !localStorageWrapper.getUtmTerm()) {
    localStorageWrapper.setUtmTerm(utmTerm)
  }
  if (utmContent && !localStorageWrapper.getUtmContent()) {
    localStorageWrapper.setUtmContent(utmContent)
  }
}
