import { useCallback, useMemo } from 'react'
import { Trans } from '@lingui/react/macro'
import SettingsForm from '@asbplayer-fork/common/components/SettingsForm'
import { MuiSettingsIsland } from '@asbplayer-fork/common/components/MuiSettingsIsland'
import { useCommandKeyBinds } from '../hooks/use-command-key-binds'
import { useLocalFontFamilies } from '@asbplayer-fork/common/hooks'
import { useSupportedLanguages } from '../hooks/use-supported-languages'
import SettingsProfileSelectMenu from '@asbplayer-fork/common/components/SettingsProfileSelectMenu'
import { AsbplayerSettings, Profile } from '@asbplayer-fork/common/settings'
import { settingsPageConfigs } from '@/services/pages'

interface Props {
  settings: AsbplayerSettings
  onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void
  profiles: Profile[]
  activeProfile?: string
  inTutorial?: boolean
  onNewProfile: (name: string) => void
  onRemoveProfile: (name: string) => void
  onSetActiveProfile: (name: string | undefined) => void
}

// The options page: a static, always-open "dialog" look (scrim + centered
// panel), replicating the old always-open MUI Dialog without Radix — there is
// nothing to dismiss or focus-trap on a dedicated page.
const SettingsPage = ({ settings, inTutorial, onSettingsChanged, ...profileContext }: Props) => {
  const { updateLocalFontsPermission, updateLocalFonts, localFontsAvailable, localFontsPermission, localFontFamilies } =
    useLocalFontFamilies()
  const handleUnlockLocalFonts = useCallback(() => {
    updateLocalFontsPermission()
    updateLocalFonts()
  }, [updateLocalFontsPermission, updateLocalFonts])

  const commands = useCommandKeyBinds()

  const handleOpenExtensionShortcuts = useCallback(() => {
    browser.tabs.create({ active: true, url: 'chrome://extensions/shortcuts' })
  }, [])

  const section = useMemo(() => {
    if (location.hash && location.hash.startsWith('#')) {
      return location.hash.substring(1, location.hash.length)
    }

    return undefined
  }, [])
  const { supportedLanguages } = useSupportedLanguages()

  if (!settings || !commands) {
    return null
  }

  return (
    <div className='bg-background relative h-dvh w-full'>
      <div className='absolute inset-0 bg-black/50' />
      <div className='bg-background relative mx-auto flex h-[calc(100dvh-64px)] w-[calc(100%-64px)] max-w-[900px] translate-y-8 flex-col gap-4 rounded-lg p-6 shadow-lg'>
        <h1 className='text-lg leading-none font-semibold'>
          <Trans>Settings</Trans>
        </h1>
        <div className='min-h-0 flex-1'>
          <SettingsForm
            extensionInstalled
            extensionVersion={browser.runtime.getManifest().version}
            extensionSupportsOverlay
            extensionSupportsTrackSpecificSettings
            extensionSupportsSubtitlesWidthSetting
            extensionSupportsPauseOnHover
            extensionSupportsExportCardBind
            extensionSupportsPageSettings
            chromeKeyBinds={commands}
            onOpenChromeExtensionShortcuts={handleOpenExtensionShortcuts}
            onSettingsChanged={onSettingsChanged}
            settings={settings}
            profiles={profileContext.profiles}
            activeProfile={profileContext.activeProfile}
            pageConfigs={settingsPageConfigs}
            localFontsAvailable={localFontsAvailable}
            localFontsPermission={localFontsPermission}
            localFontFamilies={localFontFamilies}
            supportedLanguages={supportedLanguages}
            onUnlockLocalFonts={handleUnlockLocalFonts}
            scrollToId={section}
            inTutorial={inTutorial}
          />
        </div>
        {/* Still MUI until Phase G2. */}
        <MuiSettingsIsland themeType={settings.themeType}>
          <div className='px-4'>
            <SettingsProfileSelectMenu {...profileContext} />
          </div>
        </MuiSettingsIsland>
      </div>
    </div>
  )
}

export default SettingsPage
