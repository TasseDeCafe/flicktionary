import ThemeProvider from '@mui/material/styles/ThemeProvider'
import CssBaseline from '@mui/material/CssBaseline'
import { useSettings } from '../hooks/use-settings'
import { useMemo } from 'react'
import SettingsPage from './SettingsPage'
import { createTheme } from '@asbplayer-fork/common/theme'
import { StyledEngineProvider } from '@mui/material/styles'
import { I18nProvider } from '@lingui/react'
import { i18n, setupLingui } from '../lingui'

const inTutorial = new URLSearchParams(window.location.search).get('tutorial') === 'true'

const SettingsUi = () => {
  const { settings, onSettingsChanged, profileContext } = useSettings()
  const theme = useMemo(() => settings && createTheme(settings.themeType), [settings])

  if (!settings || !theme) {
    return null
  }

  setupLingui(settings.language)

  return (
    <I18nProvider i18n={i18n}>
      <StyledEngineProvider injectFirst>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <SettingsPage
            settings={settings}
            onSettingsChanged={onSettingsChanged}
            inTutorial={inTutorial}
            {...profileContext}
          />
        </ThemeProvider>
      </StyledEngineProvider>
    </I18nProvider>
  )
}

export default SettingsUi
