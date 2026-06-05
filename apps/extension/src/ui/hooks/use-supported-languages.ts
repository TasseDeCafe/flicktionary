import { i18nConfig } from '@flicktionary/i18n/i18n-config'

// The UI ships only the languages bundled in the shared Lingui catalog (en + fr).
// Adding a locale is a one-line change in i18n-config + lingui.config.mjs.
export const useSupportedLanguages = () => {
  return { supportedLanguages: [...i18nConfig.locales] }
}
