import { i18n } from '@lingui/core'
import {
  Locale,
  ENGLISH_LOCALE,
  /* SPANISH_LOCALE, */ FRENCH_LOCALE /* , POLISH_LOCALE */,
} from '@flicktionary/i18n/i18n-config'

// Import all catalogs statically (Metro doesn't support dynamic imports with template literals)
import { messages as enMessages } from '@flicktionary/i18n/locales/en/messages.po'
// import { messages as esMessages } from '@flicktionary/i18n/locales/es/messages.po'
import { messages as frMessages } from '@flicktionary/i18n/locales/fr/messages.po'
// import { messages as plMessages } from '@flicktionary/i18n/locales/pl/messages.po'

const catalogs = {
  [ENGLISH_LOCALE]: enMessages,
  // [SPANISH_LOCALE]: esMessages,
  [FRENCH_LOCALE]: frMessages,
  // [POLISH_LOCALE]: plMessages,
}

export function activateLocale(locale: Locale) {
  const messages = catalogs[locale]
  if (!messages) {
    console.warn(`No messages found for locale: ${locale}, falling back to English`)
    i18n.loadAndActivate({ locale: ENGLISH_LOCALE, messages: catalogs[ENGLISH_LOCALE] })
    return
  }
  i18n.loadAndActivate({ locale, messages })
}

export { i18n }
