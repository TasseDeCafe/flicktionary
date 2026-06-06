import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  ExtensionToVideoCommand,
  GrantedActiveTabPermissionMessage,
  PopupToExtensionCommand,
  SettingsUpdatedMessage,
} from '@asbplayer-fork/common'
import { AsbplayerSettings, SettingsProvider } from '@asbplayer-fork/common/settings'
import { TooltipProvider } from '@flicktionary/ui/components/tooltip'
import { Toaster } from 'sonner'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { ExtensionSettingsStorage } from '../../services/extension-settings-storage'
import { isVideoPlatformUrl } from '@/services/pages'
import Popup from './Popup'
import ImportPopup from './ImportPopup'
import { useRequestingActiveTabPermission } from '../hooks/use-requesting-active-tab-permission'
import { useResolvedTheme } from '../hooks/use-resolved-theme'
import { useSettingsProfileContext } from '@asbplayer-fork/common/hooks/use-settings-profile-context'
import { getFlicktionaryConfig } from '@/services/flicktionary/flicktionary-config'
import { pushUiPrefs, refreshUiPrefsFromServer } from '@/services/flicktionary/ui-prefs-sync'
import { I18nProvider } from '@lingui/react'
import { i18n, setupLingui } from '../lingui'
import type { PopupCommands } from '../popup'

interface Props {
  commands: PopupCommands
}

const notifySettingsUpdated = () => {
  const settingsUpdatedCommand: PopupToExtensionCommand<SettingsUpdatedMessage> = {
    sender: 'asbplayer-popup',
    message: {
      command: 'settings-updated',
    },
  }
  browser.runtime.sendMessage(settingsUpdatedCommand)
}

export function PopupUi({ commands }: Props) {
  const settingsProvider = useMemo(() => new SettingsProvider(new ExtensionSettingsStorage()), [])
  const [settings, setSettings] = useState<AsbplayerSettings>()
  // Which popup to show is decided by the active tab: the full subtitle UI on
  // known video platforms, the simpler article-import UI everywhere else.
  // `undefined` while we resolve the active tab's URL.
  const [isVideoPlatform, setIsVideoPlatform] = useState<boolean>()

  useEffect(() => {
    settingsProvider.getAll().then(setSettings)
  }, [settingsProvider])

  // Pull server-set UI prefs (theme/language) on popup open; re-read settings
  // if anything changed locally.
  useEffect(() => {
    void refreshUiPrefsFromServer().then((changed) => {
      if (changed) {
        settingsProvider.getAll().then(setSettings)
        notifySettingsUpdated()
      }
    })
  }, [settingsProvider])

  useEffect(() => {
    let active = true
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => isVideoPlatformUrl(tab?.url))
      .catch(() => false)
      .then((result) => {
        if (active) setIsVideoPlatform(result)
      })
    return () => {
      active = false
    }
  }, [])

  const handleSettingsChanged = useCallback(
    async (changed: Partial<AsbplayerSettings>) => {
      setSettings((old: any) => ({ ...old, ...changed }))
      await settingsProvider.set(changed)
      notifySettingsUpdated()
      // Write-through to the server when paired (fire-and-forget).
      pushUiPrefs(changed)
    },
    [settingsProvider]
  )

  const handleOpenExtensionShortcuts = useCallback(() => {
    browser.tabs.create({ active: true, url: 'chrome://extensions/shortcuts' })
  }, [])

  const handleOpenApp = useCallback(() => {
    browser.tabs.create({ active: true, url: getFlicktionaryConfig().webUrl })
  }, [])

  const handleOpenUserGuide = useCallback(() => {
    browser.tabs.create({ active: true, url: `${getFlicktionaryConfig().webUrl}/user-guide` })
  }, [])

  const { requestingActiveTabPermission, tabRequestingActiveTabPermission } = useRequestingActiveTabPermission()

  useEffect(() => {
    if (!requestingActiveTabPermission || tabRequestingActiveTabPermission === undefined) {
      return
    }

    const command: ExtensionToVideoCommand<GrantedActiveTabPermissionMessage> = {
      sender: 'asbplayer-extension-to-video',
      message: {
        command: 'granted-active-tab-permission',
      },
      src: tabRequestingActiveTabPermission.src,
    }
    browser.tabs.sendMessage(tabRequestingActiveTabPermission.tabId, command)
    window.close()
  }, [requestingActiveTabPermission, tabRequestingActiveTabPermission])

  const handleProfileChanged = useCallback(() => {
    settingsProvider.getAll().then(setSettings)
    notifySettingsUpdated()
  }, [settingsProvider])

  const profilesContext = useSettingsProfileContext({
    settingsProvider,
    onProfileChanged: handleProfileChanged,
  })

  // Radix portals (selects, dialogs, tooltips) target document.body — outside
  // the `dark`-classed root div below — so the dark scope must also land on
  // <body> (same trap as portalContainer in the shadow surfaces).
  const resolvedTheme = useResolvedTheme(settings?.themeType)
  const dark = resolvedTheme === 'dark'
  useEffect(() => {
    document.body.classList.toggle('dark', dark)
  }, [dark])

  // Activate the Lingui catalog for the user's language. In a layout effect,
  // NOT the render body: when the locale changes, i18n.activate() setState()s
  // the mounted <I18nProvider>, which React forbids mid-render. Pre-paint, so
  // no flash of untranslated strings.
  const language = settings?.language
  useLayoutEffect(() => {
    if (language) {
      setupLingui(language)
    }
  }, [language])

  if (!settings || requestingActiveTabPermission === undefined || isVideoPlatform === undefined) {
    return null
  }

  // Dark mode is the `.dark` class on the page root (tokens.css custom
  // variant); bg/text tokens on the same element re-resolve under it.
  return (
    <I18nProvider i18n={i18n}>
      <TooltipProvider>
        <div className={cn('bg-background text-foreground w-[600px] font-sans', dark && 'dark')}>
          {isVideoPlatform ? (
            <Popup
              commands={commands}
              settings={settings}
              onSettingsChanged={handleSettingsChanged}
              onOpenApp={handleOpenApp}
              onOpenUserGuide={handleOpenUserGuide}
              onOpenExtensionShortcuts={handleOpenExtensionShortcuts}
              {...profilesContext}
            />
          ) : (
            <ImportPopup
              settings={settings}
              onSettingsChanged={handleSettingsChanged}
              onOpenApp={handleOpenApp}
              onOpenUserGuide={handleOpenUserGuide}
            />
          )}
          {/* Host for the query/mutation error toasts (meta-driven, see
              makeExtensionQueryClient) — without it toast.error is a no-op. */}
          <Toaster theme={dark ? 'dark' : 'light'} position='bottom-center' />
        </div>
      </TooltipProvider>
    </I18nProvider>
  )
}
