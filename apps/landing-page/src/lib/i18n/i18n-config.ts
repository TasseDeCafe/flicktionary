export const POLISH_LOCALE = 'pl' as const
export const ENGLISH_LOCALE = 'en' as const
export const FRENCH_LOCALE = 'fr' as const
export const SPANISH_LOCALE = 'es' as const

export const i18nConfig = {
  defaultLocale: ENGLISH_LOCALE,
  locales: [ENGLISH_LOCALE, SPANISH_LOCALE, POLISH_LOCALE, FRENCH_LOCALE],
}

export type Locale = (typeof i18nConfig)['locales'][number]
