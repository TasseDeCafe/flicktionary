import { useCallback, useMemo } from 'react'
import { makeStyles } from 'tss-react/mui'
import { Trans } from '@lingui/react/macro'
import Box from '@mui/material/Box'
import SettingsForm from '@asbplayer-fork/common/components/SettingsForm'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import { useCommandKeyBinds } from '../hooks/use-command-key-binds'
import { useLocalFontFamilies } from '@asbplayer-fork/common/hooks'
import Paper from '@mui/material/Paper'
import { useSupportedLanguages } from '../hooks/use-supported-languages'
import SettingsProfileSelectMenu from '@asbplayer-fork/common/components/SettingsProfileSelectMenu'
import { AsbplayerSettings, Profile } from '@asbplayer-fork/common/settings'
import { useTheme } from '@mui/material/styles'
import { settingsPageConfigs } from '@/services/pages'

const useStyles = makeStyles()((theme) => ({
  root: {
    '& .MuiPaper-root': {
      height: '100vh',
    },
  },
  content: {
    maxHeight: '100%',
  },
  profilesContainer: {
    paddingLeft: theme.spacing(4),
    paddingRight: theme.spacing(4),
  },
}))

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

const SettingsPage = ({ settings, inTutorial, onSettingsChanged, ...profileContext }: Props) => {
  const theme = useTheme()
  const { classes } = useStyles()

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
    <Paper square style={{ height: '100vh' }}>
      <Dialog open={true} maxWidth='md' fullWidth className={classes.root} onClose={() => {}}>
        <DialogTitle>
          <Trans>Settings</Trans>
        </DialogTitle>
        <DialogContent className={classes.content}>
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
        </DialogContent>
        <Box style={{ marginBottom: theme.spacing(2) }} className={classes.profilesContainer}>
          <SettingsProfileSelectMenu {...profileContext} />
        </Box>
      </Dialog>
    </Paper>
  )
}

export default SettingsPage
