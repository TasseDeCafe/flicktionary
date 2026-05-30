import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Bridge from '../bridge'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import { i18n } from '../lingui'
import Button from '@mui/material/Button'
import ThemeProvider from '@mui/material/styles/ThemeProvider'
import CssBaseline from '@mui/material/CssBaseline'
import { PaletteMode } from '@mui/material/styles'
import { Message, UpdateStateMessage } from '@asbplayer-fork/common'
import { createTheme } from '@asbplayer-fork/common/theme'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import LogoIcon from '@asbplayer-fork/common/components/LogoIcon'
import Link from '@mui/material/Link'

interface Props {
  bridge: Bridge
}

// The notification dialog receives a dotted loc-key over the bridge (chosen by the
// background/binding layer), so the text can't be a static macro at the call site.
// Map the known keys to lazy Lingui messages and resolve them imperatively. These
// are the only keys ever sent (see services/binding.ts).
const dialogMessages: Record<string, MessageDescriptor> = {
  'activeTabPermissionRequest.title': msg`Enable audio recording`,
  'activeTabPermissionRequest.prompt': msg`Click on the asbplayer action button in the top-right of the browser window to enable audio recording for this tab.`,
  'activeTabPermissionRequest.grantedTitle': msg`Audio recording enabled`,
  'activeTabPermissionRequest.grantedPrompt': msg`Audio recording has been enabled for this tab. You can now begin mining.`,
}

const localizeDialogKey = (locKey: string): string => {
  const descriptor = dialogMessages[locKey]
  return descriptor ? i18n._(descriptor) : locKey
}

const NotificationUi = ({ bridge }: Props) => {
  const handleClose = useCallback(() => {
    setShowAlert(false)
    setNewVersion(undefined)
    bridge.sendMessageFromServer({
      command: 'close',
    })
  }, [bridge])
  const [title, setTitle] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [newVersion, setNewVersion] = useState<string>()
  const [showAlert, setShowAlert] = useState<boolean>(false)

  useEffect(() => {
    bridge.addClientMessageListener((message: Message) => {
      if (message.command !== 'updateState') {
        return
      }

      const state = (message as UpdateStateMessage).state

      if (state.themeType !== undefined) {
        setThemeType(state.themeType)
      }

      if (state.titleLocKey !== undefined) {
        setTitle(state.titleLocKey === '' ? '' : localizeDialogKey(state.titleLocKey))
      }

      if (state.messageLocKey !== undefined) {
        setMessage(state.messageLocKey === '' ? '' : localizeDialogKey(state.messageLocKey))
      }

      if (state.newVersion !== undefined) {
        setNewVersion(state.newVersion)
        setShowAlert(true)
      }
    })
  }, [bridge])
  const [themeType, setThemeType] = useState<PaletteMode>('dark')
  const theme = useMemo(() => createTheme(themeType), [themeType])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {message && title && (
        <Dialog open={true} disableEnforceFocus fullWidth maxWidth='sm' onClose={handleClose}>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{message}</DialogContent>
          <DialogActions>
            <Button onClick={handleClose}>
              <Trans>OK</Trans>
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {newVersion && (
        <Snackbar open={showAlert} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} onClose={handleClose}>
          <Alert icon={<LogoIcon />} severity='info' onClose={handleClose}>
            <Trans>
              asbplayer updated to version {newVersion}. Check out the{' '}
              <Link
                color='primary'
                target='_blank'
                rel='noreferrer'
                href={`https://github.com/TasseDeCafe/flicktionary/releases/tag/v${newVersion}`}
              >
                release notes
              </Link>
              .
            </Trans>
          </Alert>
        </Snackbar>
      )}
    </ThemeProvider>
  )
}

export default NotificationUi
