import { ENGLISH_LOCALE, FRENCH_LOCALE, Locale /* , POLISH_LOCALE, SPANISH_LOCALE */ } from './i18n-config'

/**
 * Maps a BCP 47 language tag (e.g. `navigator.language`) to a supported UI locale.
 * Shared by the web app and the extension so "System" resolves identically everywhere.
 */
export const detectBrowserLocale = (navigatorLanguage: string | undefined): Locale => {
  const browserLang = navigatorLanguage?.split('-')[0]

  // if (browserLang === SPANISH_LOCALE) {
  //   return SPANISH_LOCALE
  // }

  // if (browserLang === POLISH_LOCALE) {
  //   return POLISH_LOCALE
  // }

  if (browserLang === FRENCH_LOCALE) {
    return FRENCH_LOCALE
  }

  return ENGLISH_LOCALE
}
