import { create } from 'zustand'
import * as Localization from 'expo-localization'
import { AppState, AppStateStatus } from 'react-native'
import { ENGLISH_LOCALE, FRENCH_LOCALE, Locale, POLISH_LOCALE, SPANISH_LOCALE } from '@template-app/i18n/i18n-config'

type LocaleStore = {
  locale: Locale
  initialize: () => void
  updateLocale: () => void
  subscribeToAppState: () => () => void
}

const getDeviceLocale = (): Locale => {
  const locales = Localization.getLocales()

  if (!locales || locales.length === 0) {
    return ENGLISH_LOCALE
  }

  const deviceLang = locales[0].languageCode

  if (deviceLang === SPANISH_LOCALE) {
    return SPANISH_LOCALE
  }

  if (deviceLang === POLISH_LOCALE) {
    return POLISH_LOCALE
  }

  if (deviceLang === FRENCH_LOCALE) {
    return FRENCH_LOCALE
  }

  return ENGLISH_LOCALE
}

export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: ENGLISH_LOCALE, // Default value before initialization

  initialize: () => {
    set({ locale: getDeviceLocale() })
  },

  updateLocale: () => {
    set({ locale: getDeviceLocale() })
  },

  subscribeToAppState: () => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // When app comes to foreground, update locale
        set({ locale: getDeviceLocale() })
      }
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange)

    return () => {
      subscription.remove()
    }
  },
}))
