import React from 'react'
import { setI18n } from '@lingui/react/server'
import { HeroSection } from '@/app/[lang]/(components)/hero-section'
import { LangProps } from '@/types/lang-props'
import { WebViewDetector } from '@/app/[lang]/(components)/web-view-detector'
import { getLinguiInstance } from '@/lib/i18n/get-lingui-instance'
import { PricingSection } from '@/app/[lang]/(components)/(pricing)/pricing-section'

export const Home = async ({ params }: { params: Promise<LangProps> }) => {
  const { lang } = await params
  const { i18n } = await getLinguiInstance(lang)
  setI18n(i18n)

  return (
    <>
      <HeroSection />

      <PricingSection />
      <div className='h-10 sm:h-20' />

      <WebViewDetector />
    </>
  )
}
