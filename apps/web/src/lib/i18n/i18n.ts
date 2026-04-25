import type { Messages } from '@lingui/core'
import { i18n } from '@lingui/core'
import { ENGLISH_LOCALE, FRENCH_LOCALE, Locale, POLISH_LOCALE, SPANISH_LOCALE } from '@template-app/i18n/i18n-config'
import { messages as enMessages } from '@template-app/i18n/locales/en/messages.po'
import { messages as esMessages } from '@template-app/i18n/locales/es/messages.po'
import { messages as frMessages } from '@template-app/i18n/locales/fr/messages.po'
import { messages as plMessages } from '@template-app/i18n/locales/pl/messages.po'

const catalogs: Record<Locale, Messages> = {
  [ENGLISH_LOCALE]: enMessages,
  [SPANISH_LOCALE]: esMessages,
  [FRENCH_LOCALE]: frMessages,
  [POLISH_LOCALE]: plMessages,
}

const loadCatalog = (locale: Locale) => {
  const messages = catalogs[locale]
  if (!messages) {
    console.warn(`Missing Lingui catalog for locale: ${locale}`)
    return
  }
  i18n.load(locale, messages)
}

const getBrowserLocale = (): Locale => {
  if (typeof navigator === 'undefined') {
    return ENGLISH_LOCALE
  }

  const browserLang = navigator.language.split('-')[0]

  if (browserLang === SPANISH_LOCALE) {
    return SPANISH_LOCALE
  }

  if (browserLang === POLISH_LOCALE) {
    return POLISH_LOCALE
  }

  if (browserLang === FRENCH_LOCALE) {
    return FRENCH_LOCALE
  }

  return ENGLISH_LOCALE
}

const defaultLocale = getBrowserLocale()
loadCatalog(defaultLocale)
i18n.activate(defaultLocale)

export { i18n }
