import ThemeProvider from '@mui/material/styles/ThemeProvider'
import CssBaseline from '@mui/material/CssBaseline'
import { useSettings } from '../hooks/use-settings'
import { useLayoutEffect, useMemo } from 'react'
import SettingsPage from './SettingsPage'
import { createTheme } from '@asbplayer-fork/common/theme'
import { StyledEngineProvider } from '@mui/material/styles'
import { I18nProvider } from '@lingui/react'
import { i18n, setupLingui } from '../lingui'

const inTutorial = new URLSearchParams(window.location.search).get('tutorial') === 'true'

const SettingsUi = () => {
  const { settings, onSettingsChanged, profileContext } = useSettings()
  const theme = useMemo(() => settings && createTheme(settings.themeType), [settings])

  // Layout effect, not render body: i18n.activate() setState()s the mounted
  // <I18nProvider>, which React forbids mid-render. Pre-paint, so no flash.
  const language = settings?.language
  useLayoutEffect(() => {
    if (language) {
      setupLingui(language)
    }
  }, [language])

  if (!settings || !theme) {
    return null
  }

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
