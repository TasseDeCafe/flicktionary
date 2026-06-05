import type { Messages } from '@lingui/core'
import { i18n } from '@lingui/core'
import {
  ENGLISH_LOCALE,
  FRENCH_LOCALE,
  i18nConfig,
  Locale /* , POLISH_LOCALE, SPANISH_LOCALE */,
} from '@flicktionary/i18n/i18n-config'
import { detectBrowserLocale } from '@flicktionary/i18n/detect-browser-locale'
import { messages as enMessages } from '@flicktionary/i18n/locales/en/messages.po'
// import { messages as esMessages } from '@flicktionary/i18n/locales/es/messages.po'
import { messages as frMessages } from '@flicktionary/i18n/locales/fr/messages.po'
// import { messages as plMessages } from '@flicktionary/i18n/locales/pl/messages.po'

const catalogs: Record<Locale, Messages> = {
  [ENGLISH_LOCALE]: enMessages,
  // [SPANISH_LOCALE]: esMessages,
  [FRENCH_LOCALE]: frMessages,
  // [POLISH_LOCALE]: plMessages,
}

// Load every catalog up front so activateLocale can switch synchronously.
for (const locale of i18nConfig.locales) {
  const messages = catalogs[locale]
  if (!messages) {
    console.warn(`Missing Lingui catalog for locale: ${locale}`)
    continue
  }
  i18n.load(locale, messages)
}

const getBrowserLocale = (): Locale => {
  if (typeof navigator === 'undefined') {
    return ENGLISH_LOCALE
  }
  return detectBrowserLocale(navigator.language)
}

export const activateLocale = (locale: Locale) => {
  i18n.activate(locale)
  document.documentElement.lang = locale
}

/**
 * Maps a server-side uiLanguage pref to the locale to activate.
 * NULL (never set), 'system', or an unsupported code all resolve to the
 * browser-detected locale.
 */
export const resolveUiLocale = (uiLanguage: string | null): Locale => {
  if (uiLanguage && uiLanguage !== 'system' && (i18nConfig.locales as readonly string[]).includes(uiLanguage)) {
    return uiLanguage as Locale
  }
  return getBrowserLocale()
}

i18n.activate(getBrowserLocale())

export { i18n }
