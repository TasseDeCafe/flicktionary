// Server sync for the UI prefs (theme + interface language) shared with the
// web app via `users.ui_theme` / `users.ui_language`.
//
// Model:
// - Reconcile once at pairing: server NULL ("never explicitly set") → push the
//   local value up; server set → pull it down locally.
// - After pairing: write-through on change (fire-and-forget, no retry queue)
//   from the two settings sinks (popup + options page), refresh from the
//   server on popup/options open.
// - Local writes go through `SettingsProvider.set` so they stay profile-scoped.
// - No loops: server→local writes never push; pushes only originate from the
//   UI sinks.
// - Offline failures leave local values intact; sign-out keeps the last local
//   values; last-write-wins across browsers (accepted).

import { AsbplayerSettings, SettingsProvider, ThemeType } from '@asbplayer-fork/common/settings'
import { ExtensionSettingsStorage } from '../extension-settings-storage'
import { getFlicktionaryApiClient } from './flicktionary-api-client'
import { getFlicktionaryAuth, onFlicktionaryAuthChange } from './auth-storage'

type UserPrefs = Awaited<ReturnType<ReturnType<typeof getFlicktionaryApiClient>['userPrefs']['getPrefs']>>['data']

const settingsProvider = new SettingsProvider(new ExtensionSettingsStorage())

const isThemeType = (value: unknown): value is ThemeType =>
  value === 'light' || value === 'dark' || value === 'system'

// One getPrefs per popup/options open, shared between the UI-prefs refresh and
// the JIT native-language picker (same memo pattern as
// flicktionary-target-language.ts). Popup realms are short-lived, so the memo
// naturally resets per open; it MUST also be invalidated on auth change or a
// re-pair/sign-in could show stale prefs.
let prefsPromise: Promise<UserPrefs | null> | undefined

onFlicktionaryAuthChange(() => {
  prefsPromise = undefined
})

export const invalidateUiPrefsSnapshot = (): void => {
  prefsPromise = undefined
}

export const getUiPrefsSnapshot = (): Promise<UserPrefs | null> => {
  if (prefsPromise === undefined) {
    prefsPromise = (async () => {
      const auth = await getFlicktionaryAuth()
      if (!auth) return null
      try {
        const { data } = await getFlicktionaryApiClient().userPrefs.getPrefs()
        return data
      } catch (error) {
        console.warn('Failed to fetch Flicktionary user prefs', error)
        // Don't cache transient failures.
        prefsPromise = undefined
        return null
      }
    })()
  }
  return prefsPromise
}

// Called from the background pair handler right after the session persists.
// Server NULL means the user never set the pref anywhere → push local up;
// server set (including an explicit 'system') → pull down.
export const reconcileUiPrefsOnPairing = async (): Promise<void> => {
  try {
    const client = getFlicktionaryApiClient()
    const { data } = await client.userPrefs.getPrefs()
    const local = await settingsProvider.get(['themeType', 'language'])

    if (data.uiTheme === null) {
      void client.userPrefs
        .setUiTheme({ uiTheme: local.themeType })
        .catch((error) => console.warn('Failed to push themeType on pairing', error))
    } else if (data.uiTheme !== local.themeType) {
      await settingsProvider.set({ themeType: data.uiTheme })
    }

    if (data.uiLanguage === null) {
      void client.userPrefs
        .setUiLanguage({ uiLanguage: local.language })
        .catch((error) => console.warn('Failed to push language on pairing', error))
    } else if (data.uiLanguage !== local.language) {
      await settingsProvider.set({ language: data.uiLanguage })
    }
  } catch (error) {
    console.warn('Failed to reconcile UI prefs on pairing', error)
  }
}

// Fire-and-forget write-through, called from the settings sinks (popup
// handleSettingsChanged + options-page useSettings.onSettingsChanged) when the
// user changes themeType/language while paired.
export const pushUiPrefs = (changed: Partial<AsbplayerSettings>): void => {
  if (changed.themeType === undefined && changed.language === undefined) {
    return
  }
  void (async () => {
    const auth = await getFlicktionaryAuth()
    if (!auth) return
    const client = getFlicktionaryApiClient()
    if (changed.themeType !== undefined) {
      void client.userPrefs
        .setUiTheme({ uiTheme: changed.themeType })
        .catch((error) => console.warn('Failed to push themeType', error))
    }
    if (changed.language !== undefined) {
      void client.userPrefs
        .setUiLanguage({ uiLanguage: changed.language })
        .catch((error) => console.warn('Failed to push language', error))
    }
  })()
}

// Pull non-NULL server values into local settings. Called on popup/options
// mount (after the initial settings load). Returns whether anything changed
// locally so the caller can re-read settings into its React state.
export const refreshUiPrefsFromServer = async (): Promise<boolean> => {
  const prefs = await getUiPrefsSnapshot()
  if (!prefs) return false

  const local = await settingsProvider.get(['themeType', 'language'])
  const updates: { themeType?: ThemeType; language?: string } = {}
  if (prefs.uiTheme !== null && isThemeType(prefs.uiTheme) && prefs.uiTheme !== local.themeType) {
    updates.themeType = prefs.uiTheme
  }
  if (prefs.uiLanguage !== null && prefs.uiLanguage !== local.language) {
    updates.language = prefs.uiLanguage
  }
  if (Object.keys(updates).length === 0) {
    return false
  }
  await settingsProvider.set(updates)
  return true
}
