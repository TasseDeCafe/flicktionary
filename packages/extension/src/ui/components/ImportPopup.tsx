import { useCallback, useState } from 'react'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import { useTheme } from '@mui/material/styles'
import { useLingui } from '@lingui/react/macro'
import { AsbplayerSettings } from '@asbplayer-fork/common/settings'
import UiSettings from '@asbplayer-fork/common/components/UiSettings'
import About from '@asbplayer-fork/common/components/About'
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
  const theme = useTheme()
  const { supportedLanguages } = useSupportedLanguages()
  const [tabIndex, setTabIndex] = useState(0)

  const handleSettingChanged = useCallback(
    <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => {
      onSettingsChanged({ [key]: value })
    },
    [onSettingsChanged]
  )

  return (
    <Paper>
      <Stack direction='column' spacing={1.5} sx={{ padding: theme.spacing(1.5) }}>
        <PopupHeader onOpenApp={onOpenApp} />
        <FlicktionaryPairSection />
        <FlicktionaryImportSection />
        <Grid container wrap='nowrap'>
          <Grid item>
            <Tabs
              orientation='vertical'
              variant='scrollable'
              scrollButtons={false}
              value={tabIndex}
              onChange={(_event, index) => setTabIndex(index)}
            >
              <Tab label={t`Misc`} id='misc-settings' />
              <Tab label={t`About Flicktionary`} id='about' />
            </Tabs>
          </Grid>
          <Grid item xs sx={{ pl: 2, minWidth: 0 }}>
            <Box hidden={tabIndex !== 0}>
              {tabIndex === 0 && (
                <Stack spacing={1}>
                  <UiSettings
                    themeType={settings.themeType}
                    language={settings.language}
                    supportedLanguages={supportedLanguages}
                    onSettingChanged={handleSettingChanged}
                  />
                </Stack>
              )}
            </Box>
            <Box hidden={tabIndex !== 1}>
              {tabIndex === 1 && <About extensionVersion={browser.runtime.getManifest().version} />}
            </Box>
          </Grid>
        </Grid>
      </Stack>
    </Paper>
  )
}

export default ImportPopup
