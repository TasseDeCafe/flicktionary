import { Command, SettingsUpdatedMessage } from '@asbplayer-fork/common'
import { AsbplayerSettings, SettingsProvider } from '@asbplayer-fork/common/settings'
import { ExtensionSettingsStorage } from '../../services/extension-settings-storage'
import { pushUiPrefs, refreshUiPrefsFromServer } from '../../services/flicktionary/ui-prefs-sync'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSettingsProfileContext } from '@asbplayer-fork/common/hooks/use-settings-profile-context'

export const useSettings = () => {
  const settingsProvider = useMemo<SettingsProvider>(() => new SettingsProvider(new ExtensionSettingsStorage()), [])
  const [settings, setSettings] = useState<AsbplayerSettings>()
  const refreshSettings = useCallback(() => settingsProvider.getAll().then(setSettings), [settingsProvider])

  useEffect(() => {
    refreshSettings()
  }, [refreshSettings])

  // Pull server-set UI prefs (theme/language) on options-page open; re-read
  // settings if anything changed locally.
  useEffect(() => {
    void refreshUiPrefsFromServer().then((changed) => {
      if (changed) {
        refreshSettings()
      }
    })
  }, [refreshSettings])

  useEffect(() => {
    browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.message?.command === 'settings-updated') {
        settingsProvider.getAll().then(setSettings)
      }
    })
  }, [settingsProvider])

  const notifySettingsUpdated = useCallback(() => {
    const command: Command<SettingsUpdatedMessage> = {
      sender: 'asbplayer-settings',
      message: {
        command: 'settings-updated',
      },
    }
    browser.runtime.sendMessage(command)
  }, [])

  const onSettingsChanged = useCallback(
    (settings: Partial<AsbplayerSettings>) => {
      setSettings((s) => ({ ...s!, ...settings }))
      settingsProvider.set(settings).then(() => notifySettingsUpdated())
      // Write-through to the server when paired (fire-and-forget).
      pushUiPrefs(settings)
    },
    [settingsProvider, notifySettingsUpdated]
  )

  const handleProfileChanged = useCallback(() => {
    refreshSettings()
    notifySettingsUpdated()
  }, [refreshSettings, notifySettingsUpdated])

  const profileContext = useSettingsProfileContext({
    settingsProvider,
    onProfileChanged: handleProfileChanged,
  })

  return { settings, onSettingsChanged, profileContext }
}
