import { useCallback } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Info, Settings2 } from 'lucide-react'
import { AsbplayerSettings } from '@asbplayer-fork/common/settings'
import UiSettings from '@asbplayer-fork/common/components/UiSettings'
import About from '@asbplayer-fork/common/components/About'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@flicktionary/ui/components/tabs'
import { useSupportedLanguages } from '../hooks/use-supported-languages'
import { FlicktionaryPairSection } from './FlicktionaryPairSection'
import { FlicktionaryImportSection } from './FlicktionaryImportSection'
import { PopupHeader } from './PopupHeader'

interface Props {
  settings: AsbplayerSettings
  onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void
  onOpenApp: () => void
  onOpenUserGuide: () => void
}

// Simplified popup shown on non-video pages: sign-in + article import, plus the
// two settings that still apply off-platform (UI theme/language) and the About
// section. Deliberately separate from the full video Popup to keep the two
// surfaces from entangling.
const ImportPopup = ({ settings, onSettingsChanged, onOpenApp, onOpenUserGuide }: Props) => {
  const { t } = useLingui()
  const { supportedLanguages } = useSupportedLanguages()

  const handleSettingChanged = useCallback(
    <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => {
      onSettingsChanged({ [key]: value })
    },
    [onSettingsChanged]
  )

  // Sidebar-nav style matching the full popup's SettingsForm (heightConstrained
  // variant): ghost items on a transparent list, accent pill on the active item.
  const triggerClasses = cn(
    'min-h-[38px] w-full justify-start gap-2.5 px-3 text-left text-xs whitespace-normal transition-colors',
    'data-[state=inactive]:hover:bg-muted/60 data-[state=inactive]:hover:text-foreground',
    'data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none'
  )

  return (
    <div className='flex flex-col gap-3 p-3'>
      <PopupHeader onOpenApp={onOpenApp} onOpenUserGuide={onOpenUserGuide} />
      <FlicktionaryPairSection />
      <FlicktionaryImportSection />
      <Tabs defaultValue='misc' orientation='vertical' className='flex-row gap-1'>
        <TabsList className='h-fit w-[164px] shrink-0 flex-col items-stretch gap-0.5 rounded-none bg-transparent p-0'>
          <TabsTrigger value='misc' className={triggerClasses}>
            <Settings2 />
            {t`Misc`}
          </TabsTrigger>
          <TabsTrigger value='about' className={triggerClasses}>
            <Info />
            {t`About Flicktionary`}
          </TabsTrigger>
        </TabsList>
        <TabsContent value='misc' className='flex min-w-0 flex-col gap-2 pr-2 pl-4'>
          <UiSettings
            themeType={settings.themeType}
            language={settings.language}
            supportedLanguages={supportedLanguages}
            onSettingChanged={handleSettingChanged}
          />
        </TabsContent>
        <TabsContent value='about' className='min-w-0 pr-2 pl-4'>
          <About extensionVersion={browser.runtime.getManifest().version} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default ImportPopup
