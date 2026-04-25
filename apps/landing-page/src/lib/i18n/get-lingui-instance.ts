import { type Messages, setupI18n } from '@lingui/core'
import { Locale } from '@template-app/i18n/i18n-config'
import { cache } from 'react'

const loadCatalog = async (locale: Locale): Promise<Messages> => {
  const catalog = await import(`@template-app/i18n/locales/${locale}/messages.po`)
  return catalog.messages
}

export const getLinguiInstance = cache(async (locale: Locale) => {
  const messages = await loadCatalog(locale)
  const i18n = setupI18n()
  i18n.load(locale, messages)
  i18n.activate(locale)
  return { i18n, messages, linguiLocale: locale }
})
