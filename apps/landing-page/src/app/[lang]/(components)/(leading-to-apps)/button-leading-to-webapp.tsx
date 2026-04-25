'use client'

import React, { ReactNode } from 'react'
import { localStorageWrapper } from '@/lib/storage/local-storage'
import { getConfig } from '@/config/environment-config'
import { Button } from '@/components/ui/button'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'

type ButtonLeadingToWebapp = {
  buttonText: ReactNode
  className: string
  analyticsClickName: string
  planInterval?: string
}

// this button should be the only way to get to the app
// this will help us encapsulate the complex logic of passing the partnerId and the priceId to the app
export const ButtonLeadingToWebapp = ({
  buttonText,
  className,
  planInterval,
  analyticsClickName,
}: ButtonLeadingToWebapp) => {
  const handleClick = () => {
    POSTHOG_EVENTS.click(analyticsClickName)

    const referral = localStorageWrapper.getReferral()
    const params = new URLSearchParams()

    if (planInterval) {
      params.append('planInterval', planInterval)
    }
    if (referral) {
      params.append('partnerId', referral)
    }

    const utmSource = localStorageWrapper.getUtmSource()
    const utmMedium = localStorageWrapper.getUtmMedium()
    const utmCampaign = localStorageWrapper.getUtmCampaign()
    const utmTerm = localStorageWrapper.getUtmTerm()
    const utmContent = localStorageWrapper.getUtmContent()

    if (utmSource) {
      params.append('utm_source', utmSource)
    }
    if (utmMedium) {
      params.append('utm_medium', utmMedium)
    }
    if (utmCampaign) {
      params.append('utm_campaign', utmCampaign)
    }
    if (utmTerm) {
      params.append('utm_term', utmTerm)
    }
    if (utmContent) {
      params.append('utm_content', utmContent)
    }

    const queryString = params.toString()
    const newUrl = `${getConfig().webUrl}/from-landing${queryString ? `?${queryString}` : ''}`
    window.location.href = newUrl
  }

  return (
    <Button className={className} onClick={handleClick}>
      {buttonText}
    </Button>
  )
}
