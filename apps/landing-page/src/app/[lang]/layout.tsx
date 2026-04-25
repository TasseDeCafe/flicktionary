import { Nunito } from 'next/font/google'
import './globals.css'
import React from 'react'
import Navbar from '@/app/[lang]/(navbar)/navbar'
import Footer from '@/app/[lang]/(footer)/footer'
import { i18nConfig, Locale } from '@/lib/i18n/i18n-config'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AnalyticsPageViewLauncher } from '@/lib/analytics/analytics-page-view-launcher'
import { AnalyticsInitializer } from '@/lib/analytics/analytics-initializer'
import { LinguiClientProvider } from '@/lib/i18n/lingui-client-provider'
import { getLinguiInstance } from '@/lib/i18n/get-lingui-instance'
import { setI18n } from '@lingui/react/server'
import { Trans } from '@lingui/react/macro'
import { AppBanner } from '@/app/[lang]/(components)/(leading-to-apps)/app-banner'

const nunito = Nunito({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'TemplateApp - Master Your Pronunciation',
  description:
    'Master your accent and pronunciation in any language with AI-powered voice cloning technology. Practice with your own voice and achieve native-like pronunciation.',
  alternates: {
    canonical: 'https://www.app-monorepo-template.dev',
  },
}

const localeSet: Set<string> = new Set(i18nConfig.locales)

const isLocale = (value: string): value is Locale => localeSet.has(value)

const RootLayout = async ({ children, params }: LayoutProps<'/[lang]'>) => {
  const { lang } = await params

  if (!isLocale(lang)) {
    notFound()
  }

  const { i18n, messages, linguiLocale } = await getLinguiInstance(lang)
  setI18n(i18n)

  return (
    <html lang={lang} className={nunito.className}>
      <body className='flex h-dvh w-full flex-col justify-between bg-gray-50'>
        <LinguiClientProvider initialLocale={linguiLocale} initialMessages={messages}>
          <AnalyticsInitializer />
          <AnalyticsPageViewLauncher />
          <AppBanner
            appName={<Trans>TemplateApp</Trans>}
            category={<Trans>Category of the app</Trans>}
            purchases={<Trans>In-App Purchases</Trans>}
          />
          <Navbar lang={lang} />
          <main className='flex w-full flex-1 flex-col items-center justify-center transition-all duration-300 ease-in-out'>
            {children}
          </main>
          <Footer lang={lang} />
        </LinguiClientProvider>
      </body>
    </html>
  )
}

export default RootLayout
