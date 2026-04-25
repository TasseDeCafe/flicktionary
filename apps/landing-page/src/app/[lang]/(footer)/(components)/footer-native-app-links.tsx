'use client'

import Link from 'next/link'
import Image from 'next/image'
import { getConfig } from '@/config/environment-config'
import { buildIosAppStoreLink } from '@/app/[lang]/(components)/(leading-to-apps)/ios-app-store-link-utils'
import { buildAndroidPlayStoreLink } from '@/app/[lang]/(components)/(leading-to-apps)/google-play-store-link-utils'
import { useEffect, useState } from 'react'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'

import { ReactNode } from 'react'

export const FooterNativeAppLinks = ({
  iosAppText,
  androidAppText,
}: {
  iosAppText: ReactNode
  androidAppText: ReactNode
}) => {
  const [iosAppStoreUrl, setIosAppStoreUrl] = useState('')
  const [androidPlayStoreUrl, setAndroidPlayStoreUrl] = useState('')

  useEffect(() => {
    setIosAppStoreUrl(buildIosAppStoreLink())
    setAndroidPlayStoreUrl(buildAndroidPlayStoreLink())
  }, [])

  return (
    <div className='flex w-full flex-row items-center justify-center gap-x-4'>
      {getConfig().featureFlags.shouldInformAboutIosNativeApp() && iosAppStoreUrl && (
        <Link
          onClick={() => {
            POSTHOG_EVENTS.click('ios_store_link_in_footer')
          }}
          href={iosAppStoreUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='mr-4 flex items-center gap-2 hover:underline'
        >
          <Image
            src='/images/icons/apple-logo.svg'
            alt='Apple logo'
            width={16}
            height={20}
            className='brightness-0 invert'
          />
          {iosAppText}
        </Link>
      )}
      {getConfig().featureFlags.shouldInformAboutAndroidNativeApp() && androidPlayStoreUrl && (
        <Link
          onClick={() => {
            POSTHOG_EVENTS.click('android_store_link_in_footer')
          }}
          href={androidPlayStoreUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-2 hover:underline'
        >
          <Image
            src='/images/icons/android-logo.svg'
            alt='Android logo'
            width={20}
            height={12}
            className='brightness-0 invert'
          />
          {androidAppText}
        </Link>
      )}
    </div>
  )
}
