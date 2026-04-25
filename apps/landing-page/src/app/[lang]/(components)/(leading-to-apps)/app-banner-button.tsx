'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@template-app/core/utils/tailwind-utils'
import { isAndroid } from '@template-app/core/utils/browser-utils'
import { buildIosAppStoreLink } from '@/app/[lang]/(components)/(leading-to-apps)/ios-app-store-link-utils'
import { buildAndroidPlayStoreLink } from '@/app/[lang]/(components)/(leading-to-apps)/google-play-store-link-utils'

type ButtonLeadingToNativeAppProps = {
  className?: string
}

export const AppBannerButton = ({ className }: ButtonLeadingToNativeAppProps) => {
  const [appLink, setAppLink] = useState<string>('')

  useEffect(() => {
    if (isAndroid()) {
      setAppLink(buildAndroidPlayStoreLink())
    } else {
      setAppLink(buildIosAppStoreLink())
    }
  }, [])

  return (
    <Button
      className={cn(
        'h-8 min-w-16 rounded-full bg-blue-500 px-4 py-1 text-sm font-semibold text-white hover:bg-blue-600 active:bg-blue-700',
        className
      )}
      href={appLink}
    >
      GET
    </Button>
  )
}
