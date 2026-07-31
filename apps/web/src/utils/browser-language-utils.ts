import { isSupportedLanguageCode, type SupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'

// Best-effort guess at the user's native language from the browser locale.
// Pins the default in the onboarding picker and seeds guest accounts (which
// skip onboarding entirely).
export const detectBrowserLanguage = (): SupportedLanguageCode => {
  if (typeof navigator === 'undefined') return 'en'
  const raw = navigator.language?.split('-')[0]?.toLowerCase()
  return raw && isSupportedLanguageCode(raw) ? raw : 'en'
}
