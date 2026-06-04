import React, { useCallback, useState, useEffect } from 'react'
import { useLingui } from '@lingui/react/macro'
import { AsbplayerSettings, PageConfig, PageSettings, Profile } from '@asbplayer-fork/common/settings'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@flicktionary/ui/components/tabs'
import About from './About'
import SubtitleAppearanceSettingsTab from './SubtitleAppearanceSettingsTab'
import KeyboardShortcutsSettingsTab from './KeyboardShortcutsSettingsTab'
import StreamingVideoSettingsTab from './StreamingVideoSettingsTab'
import MiscSettingsTab from './MiscSettingsTab'
import { MuiSettingsIsland } from './MuiSettingsIsland'

type TabName = 'subtitle-appearance' | 'keyboard-shortcuts' | 'streaming-video' | 'misc-settings' | 'about'

const tabNames: TabName[] = ['subtitle-appearance', 'keyboard-shortcuts', 'streaming-video', 'misc-settings', 'about']

interface SettingsFormPageConfig extends PageConfig {
  faviconUrl: string
}

export type PageConfigMap = { [K in keyof PageSettings]: SettingsFormPageConfig }

interface Props {
  extensionInstalled: boolean
  extensionVersion?: string
  extensionSupportsOverlay: boolean
  extensionSupportsTrackSpecificSettings: boolean
  extensionSupportsSubtitlesWidthSetting: boolean
  extensionSupportsPauseOnHover: boolean
  extensionSupportsExportCardBind: boolean
  extensionSupportsPageSettings: boolean
  insideApp?: boolean
  appVersion?: string
  settings: AsbplayerSettings
  profiles: Profile[]
  activeProfile?: string
  pageConfigs?: PageConfigMap
  scrollToId?: string
  chromeKeyBinds: { [key: string]: string | undefined }
  localFontsAvailable: boolean
  localFontsPermission?: PermissionState
  localFontFamilies: string[]
  supportedLanguages: string[]
  forceVerticalTabs?: boolean
  inTutorial?: boolean
  heightConstrained?: boolean
  onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void
  onOpenChromeExtensionShortcuts: () => void
  onUnlockLocalFonts: () => void
}

const useMatchMedia = (query: string) => {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query)
    const handleChange = () => setMatches(mediaQueryList.matches)
    mediaQueryList.addEventListener('change', handleChange)
    handleChange()
    return () => mediaQueryList.removeEventListener('change', handleChange)
  }, [query])

  return matches
}

export default function SettingsForm({
  settings,
  pageConfigs,
  extensionInstalled,
  extensionVersion,
  extensionSupportsOverlay,
  extensionSupportsTrackSpecificSettings,
  extensionSupportsSubtitlesWidthSetting,
  extensionSupportsPauseOnHover,
  extensionSupportsExportCardBind,
  extensionSupportsPageSettings,
  insideApp,
  appVersion,
  scrollToId,
  chromeKeyBinds,
  localFontsAvailable,
  localFontsPermission,
  localFontFamilies,
  supportedLanguages,
  forceVerticalTabs,
  heightConstrained,
  onSettingsChanged,
  onOpenChromeExtensionShortcuts,
  onUnlockLocalFonts,
}: Props) {
  // Width-responsive like the MUI original (breakpoint 500px), except where the
  // caller pins the orientation (the 600px-wide popup always fits vertical tabs).
  const smallScreen = useMatchMedia('(max-width: 500px)') && !forceVerticalTabs
  const handleSettingChanged = useCallback(
    async <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => {
      onSettingsChanged({ [key]: value })
    },
    [onSettingsChanged]
  )
  const { t } = useLingui()
  const [tabValue, setTabValue] = useState<TabName>('subtitle-appearance')

  useEffect(() => {
    if (scrollToId && (tabNames as string[]).includes(scrollToId)) {
      setTabValue(scrollToId as TabName)
    }
  }, [scrollToId])

  const vertical = !smallScreen
  const triggerClasses = cn(
    vertical && 'w-full justify-start',
    heightConstrained ? 'min-h-[38px] text-xs' : 'min-h-[42px] text-sm'
  )
  const panelClasses = cn('h-full max-h-full w-full overflow-y-auto', vertical ? 'pr-2 pl-4' : 'p-2')

  return (
    <Tabs
      value={tabValue}
      onValueChange={(value) => setTabValue(value as TabName)}
      orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn('h-full max-h-full', vertical ? 'flex-row gap-0' : 'flex-col gap-2')}
    >
      <TabsList className={cn(vertical ? 'h-fit w-[130px] shrink-0 flex-col' : 'mx-auto max-w-full overflow-x-auto')}>
        <TabsTrigger value='subtitle-appearance' className={triggerClasses}>
          {t`Subtitle Appearance`}
        </TabsTrigger>
        <TabsTrigger value='keyboard-shortcuts' className={triggerClasses}>
          {t`Keyboard Shortcuts`}
        </TabsTrigger>
        <TabsTrigger value='streaming-video' className={triggerClasses}>
          {t`Streaming Video`}
        </TabsTrigger>
        <TabsTrigger value='misc-settings' className={triggerClasses}>
          {t`Misc`}
        </TabsTrigger>
        <TabsTrigger value='about' className={triggerClasses}>
          {t`About Flicktionary`}
        </TabsTrigger>
      </TabsList>
      {/* SubtitleAppearance + KeyboardShortcuts are still MUI until Phase G2 —
          they need the legacy ThemeProvider island for dark mode / accents. */}
      <MuiSettingsIsland themeType={settings.themeType}>
        <TabsContent value='subtitle-appearance' className={panelClasses}>
          <SubtitleAppearanceSettingsTab
            settings={settings}
            onSettingChanged={handleSettingChanged}
            onSettingsChanged={onSettingsChanged}
            extensionInstalled={extensionInstalled}
            extensionSupportsTrackSpecificSettings={extensionSupportsTrackSpecificSettings}
            extensionSupportsSubtitlesWidthSetting={extensionSupportsSubtitlesWidthSetting}
            localFontsAvailable={localFontsAvailable}
            localFontsPermission={localFontsPermission}
            localFontFamilies={localFontFamilies}
            onUnlockLocalFonts={onUnlockLocalFonts}
          />
        </TabsContent>
        <TabsContent value='keyboard-shortcuts' className={panelClasses}>
          <KeyboardShortcutsSettingsTab
            settings={settings}
            onSettingChanged={handleSettingChanged}
            chromeKeyBinds={chromeKeyBinds}
            extensionInstalled={extensionInstalled}
            extensionSupportsExportCardBind={extensionSupportsExportCardBind}
            onOpenChromeExtensionShortcuts={onOpenChromeExtensionShortcuts}
          />
        </TabsContent>
      </MuiSettingsIsland>
      <TabsContent value='streaming-video' className={panelClasses}>
        <StreamingVideoSettingsTab
          settings={settings}
          onSettingChanged={handleSettingChanged}
          onSettingsChanged={onSettingsChanged}
          insideApp={insideApp}
          extensionSupportsOverlay={extensionSupportsOverlay}
          extensionSupportsPageSettings={extensionSupportsPageSettings}
          pageConfigs={pageConfigs}
        />
      </TabsContent>
      <TabsContent value='misc-settings' className={panelClasses}>
        <MiscSettingsTab
          settings={settings}
          onSettingChanged={handleSettingChanged}
          onSettingsChanged={onSettingsChanged}
          supportedLanguages={supportedLanguages}
          insideApp={insideApp}
          extensionInstalled={extensionInstalled}
          extensionSupportsPauseOnHover={extensionSupportsPauseOnHover}
        />
      </TabsContent>
      <TabsContent value='about' className={panelClasses}>
        <About
          appVersion={insideApp ? appVersion : undefined}
          extensionVersion={extensionInstalled ? extensionVersion : undefined}
        />
      </TabsContent>
    </Tabs>
  )
}
