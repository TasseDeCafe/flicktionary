import { useCallback } from 'react'
import { useLingui } from '@lingui/react/macro'
import { AsbplayerSettings } from '@asbplayer-fork/common/settings'
import UiSettings from '@asbplayer-fork/common/components/UiSettings'
import About from '@asbplayer-fork/common/components/About'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@flicktionary/ui/components/tabs'
import { useSupportedLanguages } from '../hooks/use-supported-languages'
import { FlicktionaryPairSection } from './FlicktionaryPairSection'
import { FlicktionaryImportSection } from './FlicktionaryImportSection'
import { PopupHeader } from './PopupHeader'

interface Props {
  settings: AsbplayerSettings
  onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void
  onOpenApp: () => void
}

// Simplified popup shown on non-video pages: sign-in + article import, plus the
// two settings that still apply off-platform (UI theme/language) and the About
// section. Deliberately separate from the full video Popup to keep the two
// surfaces from entangling.
const ImportPopup = ({ settings, onSettingsChanged, onOpenApp }: Props) => {
  const { t } = useLingui()
  const { supportedLanguages } = useSupportedLanguages()

  const handleSettingChanged = useCallback(
    <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => {
      onSettingsChanged({ [key]: value })
    },
    [onSettingsChanged]
  )

  return (
    <div className='flex flex-col gap-3 p-3'>
      <PopupHeader onOpenApp={onOpenApp} />
      <FlicktionaryPairSection />
      <FlicktionaryImportSection />
      <Tabs defaultValue='misc' orientation='vertical' className='flex-row gap-4'>
        <TabsList className='h-fit shrink-0 flex-col'>
          <TabsTrigger value='misc' className='w-full justify-start'>
            {t`Misc`}
          </TabsTrigger>
          <TabsTrigger value='about' className='w-full justify-start'>
            {t`About Flicktionary`}
          </TabsTrigger>
        </TabsList>
        <TabsContent value='misc' className='flex min-w-0 flex-col gap-2'>
          <UiSettings
            themeType={settings.themeType}
            language={settings.language}
            supportedLanguages={supportedLanguages}
            onSettingChanged={handleSettingChanged}
          />
        </TabsContent>
        <TabsContent value='about' className='min-w-0'>
          <About extensionVersion={browser.runtime.getManifest().version} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default ImportPopup
