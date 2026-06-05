import { AsbplayerSettings, Profile, chromeCommandBindsToKeyBinds } from '@asbplayer-fork/common/settings'
import SettingsForm from '@asbplayer-fork/common/components/SettingsForm'
import { useCallback } from 'react'
import { useLocalFontFamilies } from '@asbplayer-fork/common/hooks'
import { useSupportedLanguages } from '../hooks/use-supported-languages'
import SettingsProfileSelectMenu from '@asbplayer-fork/common/components/SettingsProfileSelectMenu'
import { settingsPageConfigs } from '@/services/pages'
import { useIsTestUser } from '../hooks/use-is-test-user'
import { AdminSettingsTab } from './AdminSettingsTab'
import { FlicktionaryPairSection } from './FlicktionaryPairSection'
import { PopupHeader } from './PopupHeader'
import type { PopupCommands } from '../popup'

interface Props {
  settings: AsbplayerSettings
  commands: PopupCommands
  onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void
  onOpenApp: () => void
  onOpenExtensionShortcuts: () => void
  profiles: Profile[]
  activeProfile?: string
  onNewProfile: (name: string) => void
  onRemoveProfile: (name: string) => void
  onSetActiveProfile: (name: string | undefined) => void
}

const Popup = ({
  settings,
  commands,
  onOpenApp,
  onSettingsChanged,
  onOpenExtensionShortcuts,
  ...profilesContext
}: Props) => {
  const handleUnlockLocalFonts = useCallback(() => {
    browser.tabs.create({
      url: `${browser.runtime.getURL('/options.html')}#subtitle-appearance`,
      active: true,
    })
  }, [])
  const { supportedLanguages } = useSupportedLanguages()
  const { localFontsAvailable, localFontsPermission, localFontFamilies } = useLocalFontFamilies()
  const isTestUser = useIsTestUser()

  return (
    <div className='flex flex-col gap-3 p-3'>
      <PopupHeader onOpenApp={onOpenApp} />
      <FlicktionaryPairSection />
      <div className='h-[390px]'>
        <SettingsForm
          heightConstrained
          extensionInstalled
          extensionVersion={browser.runtime.getManifest().version}
          extensionSupportsOverlay
          extensionSupportsTrackSpecificSettings
          extensionSupportsSubtitlesWidthSetting
          extensionSupportsPauseOnHover
          extensionSupportsExportCardBind
          extensionSupportsPageSettings
          forceVerticalTabs={false}
          chromeKeyBinds={chromeCommandBindsToKeyBinds(commands)}
          settings={settings}
          profiles={profilesContext.profiles}
          activeProfile={profilesContext.activeProfile}
          pageConfigs={settingsPageConfigs}
          localFontsAvailable={localFontsAvailable}
          localFontsPermission={localFontsPermission}
          localFontFamilies={localFontFamilies}
          supportedLanguages={supportedLanguages}
          adminTab={isTestUser ? <AdminSettingsTab /> : undefined}
          onSettingsChanged={onSettingsChanged}
          onOpenChromeExtensionShortcuts={onOpenExtensionShortcuts}
          onUnlockLocalFonts={handleUnlockLocalFonts}
        />
      </div>
      <SettingsProfileSelectMenu {...profilesContext} />
    </div>
  )
}

export default Popup
