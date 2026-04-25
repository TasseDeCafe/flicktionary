'use client'

import { getConfig } from '@/config/environment-config'
import { AppBannerButton } from '@/app/[lang]/(components)/(leading-to-apps)/app-banner-button'
import Image from 'next/image'
import { isAndroid } from '@template-app/core/utils/browser-utils'

import { ReactNode } from 'react'

interface AppBannerProps {
  appName: ReactNode
  category: ReactNode
  purchases: ReactNode
}

export const AppBanner = ({ appName, category, purchases }: AppBannerProps) => {
  const config = getConfig()

  if (isAndroid() && !config.featureFlags.shouldInformAboutAndroidNativeApp()) {
    return null
  }

  if (!config.featureFlags.shouldInformAboutIosNativeApp()) {
    return null
  }

  return (
    <div className='relative z-50 flex w-full items-center border-b border-gray-200 bg-white px-4 py-2 sm:hidden'>
      <div className='flex flex-1 items-center space-x-3'>
        <div className='flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50'>
          <Image src='/images/logo-full.png' alt='TemplateApp logo' width={40} height={40} priority />
        </div>
        <div className='flex-1'>
          <p className='text-base font-medium text-gray-900'>{appName}</p>
          <p className='text-sm text-gray-500'>{category}</p>
          <p className='text-xs text-gray-400'>{purchases}</p>
        </div>
      </div>

      <div className='flex items-center pr-2'>
        <AppBannerButton />
      </div>
    </div>
  )
}
