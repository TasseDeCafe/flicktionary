export const ENGLISH_LOCALE = 'en'
export const POLISH_LOCALE = 'pl'
export const SPANISH_LOCALE = 'es'
export const FRENCH_LOCALE = 'fr'

export const i18nConfig = {
  defaultLocale: ENGLISH_LOCALE,
  locales: [ENGLISH_LOCALE, SPANISH_LOCALE, FRENCH_LOCALE, POLISH_LOCALE],
} as const

export type Locale = (typeof i18nConfig.locales)[number]
