'use client'

import { I18nProvider } from '@lingui/react'
import { setupI18n, type Messages } from '@lingui/core'
import { Locale } from '@template-app/i18n/i18n-config'
import { ReactNode, useState } from 'react'

type LinguiClientProviderProps = {
  children: ReactNode
  initialLocale: Locale
  initialMessages: Messages
}

export const LinguiClientProvider = ({ children, initialLocale, initialMessages }: LinguiClientProviderProps) => {
  const [clientI18n] = useState(() =>
    setupI18n({
      locale: initialLocale,
      messages: { [initialLocale]: initialMessages },
    })
  )

  return <I18nProvider i18n={clientI18n}>{children}</I18nProvider>
}
