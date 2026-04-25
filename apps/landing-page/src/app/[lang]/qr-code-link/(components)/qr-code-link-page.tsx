'use client'

import React, { ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { buildIosAppStoreLink } from '@/app/[lang]/(components)/(leading-to-apps)/ios-app-store-link-utils'
import { isAndroid } from '@template-app/core/utils/browser-utils'
import { buildAndroidPlayStoreLink } from '@/app/[lang]/(components)/(leading-to-apps)/google-play-store-link-utils'
import { getConfig } from '@/config/environment-config'

interface QRCodeLinkPageProps {
  continueButtonText: ReactNode
  referral?: string
  utm_source?: string
  utm_campaign?: string
  utm_medium?: string
  utm_content?: string
  utm_term?: string
}

export const QRCodeLinkPage = ({
  continueButtonText,
  referral,
  utm_source,
  utm_campaign,
  utm_medium,
  utm_content,
  utm_term,
}: QRCodeLinkPageProps) => {
  const [appLink, setAppLink] = useState<string>('')

  useEffect(() => {
    if (referral && !localStorage.getItem('referral')) {
      localStorage.setItem('referral', referral)
    }
    if (utm_source && !localStorage.getItem('utm_source')) {
      localStorage.setItem('utm_source', utm_source)
    }
    if (utm_campaign && !localStorage.getItem('utm_campaign')) {
      localStorage.setItem('utm_campaign', utm_campaign)
    }
    if (utm_medium && !localStorage.getItem('utm_medium')) {
      localStorage.setItem('utm_medium', utm_medium)
    }
    if (utm_content && !localStorage.getItem('utm_content')) {
      localStorage.setItem('utm_content', utm_content)
    }
    if (utm_term && !localStorage.getItem('utm_term')) {
      localStorage.setItem('utm_term', utm_term)
    }

    if (getConfig().featureFlags.shouldInformAboutAndroidNativeApp()) {
      if (isAndroid()) {
        setAppLink(buildAndroidPlayStoreLink())
      } else {
        setAppLink(buildIosAppStoreLink)
      }
    } else {
      setAppLink(buildIosAppStoreLink())
    }
  }, [referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term])

  return (
    <div className='flex min-h-screen justify-center bg-gray-50 p-4'>
      <Button
        href={appLink}
        className='mt-40 h-12 w-60 bg-blue-600 text-xl font-semibold text-white transition-colors duration-150 hover:bg-blue-700'
      >
        {continueButtonText}
      </Button>
    </div>
  )
}
