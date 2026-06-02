import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { Trans } from '@lingui/react/macro'
import ThemeProvider from '@mui/material/styles/ThemeProvider'
import CssBaseline from '@mui/material/CssBaseline'
import Paper from '@mui/material/Paper'
import { createTheme } from '@asbplayer-fork/common/theme'
import { makeStyles } from 'tss-react/mui'
import CenteredGridContainer from './CenteredGridContainer'
import CenteredGridItem from './CenteredGridItem'
import React, { useEffect, useState } from 'react'
import Tutorial from './Tutorial'
import { I18nProvider } from '@lingui/react'
import { i18n, setupLingui } from '../lingui'

const useStyles = makeStyles()({
  container: {
    scrollSnapType: 'y mandatory',
    width: '100dvw',
    height: '100dvh',
    overflowY: 'scroll',
  },
  child: {
    scrollSnapAlign: 'center',
    width: '100dvw',
    height: '100dvh',
  },
})

const WelcomeMessage: React.FC<{ className: string }> = ({ className }) => {
  return (
    <CenteredGridContainer className={className} direction='column'>
      <CenteredGridItem>
        <img style={{ width: 75 }} src={browser.runtime.getURL('/icon/image.png')} />
      </CenteredGridItem>
      <CenteredGridItem>
        <Typography variant='h5'>
          <Trans>Welcome to Flicktionary.</Trans>
        </Typography>
      </CenteredGridItem>
      <CenteredGridItem>
        <Typography variant='h6'>
          <Trans>
            Scroll down for a quick intro, or check out the{' '}
            <Link color='primary' target='_blank' rel='noreferrer' href={'https://www.flicktionary.app'}>
              user guide
            </Link>
            .
          </Trans>
        </Typography>
      </CenteredGridItem>
    </CenteredGridContainer>
  )
}

const useLangParam = () => {
  const [lang, setLang] = useState<string>()
  useEffect(() => setLang(new URLSearchParams(window.location.search).get('lang') ?? undefined), [])
  return lang
}

const FtueUi = () => {
  const theme = createTheme('dark')
  const langParam = useLangParam()
  const { classes } = useStyles()
  const [showTutorial, setShowTutorial] = useState<boolean>(false)
  const [hideWelcomePanel, setHideWelcomePanel] = useState<boolean>(false)

  const handleContainerRef = (elm: HTMLDivElement | null) => {
    if (!elm) {
      return
    }

    elm.onscrollend = () => {
      if (elm.scrollTop > (window.innerHeight * 3) / 4) {
        setHideWelcomePanel(true)
        setShowTutorial(true)
      }
    }
  }

  setupLingui(langParam ?? browser.i18n.getUILanguage())

  return (
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Paper ref={handleContainerRef} className={classes.container} square>
          {!hideWelcomePanel && <WelcomeMessage className={classes.child} />}
          <Tutorial show={showTutorial} className={classes.child} />
        </Paper>
      </ThemeProvider>
    </I18nProvider>
  )
}

export default FtueUi
