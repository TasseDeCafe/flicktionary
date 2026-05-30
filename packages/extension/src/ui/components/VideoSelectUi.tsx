import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import CssBaseline from '@mui/material/CssBaseline'
import CloseIcon from '@mui/icons-material/Close'
import SettingsIcon from '@mui/icons-material/Settings'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import ThemeProvider from '@mui/material/styles/ThemeProvider'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Bridge from '../bridge'
import {
  Message,
  UpdateStateMessage,
  VideoSelectModeCancelMessage,
  VideoSelectModeConfirmMessage,
} from '@asbplayer-fork/common'
import { createTheme } from '@asbplayer-fork/common/theme'
import { PaletteMode } from '@mui/material/styles'

interface Props {
  bridge: Bridge
}

export interface VideoElement {
  src: string
  imageDataUrl: string
}

export default function VideoSelectUi({ bridge }: Props) {
  const [open, setOpen] = useState<boolean>(false)
  const [themeType, setThemeType] = useState<string>('dark')
  const [videoElements, setVideoElements] = useState<VideoElement[]>([])
  const [selectedVideoElementSrc, setSelectedVideoElementSrc] = useState<string>('')
  const [openedFromMiningCommand, setOpenedFromMiningCommand] = useState<boolean>(false)
  const { t } = useLingui()

  const theme = useMemo(() => createTheme(themeType as PaletteMode), [themeType])

  useEffect(() => {
    return bridge.addClientMessageListener((message: Message) => {
      if (message.command !== 'updateState') {
        return
      }

      const state = (message as UpdateStateMessage).state

      if (state.open !== undefined) {
        setOpen(state.open)
      }

      if (state.themeType !== undefined) {
        setThemeType(state.themeType)
      }

      if (state.videoElements !== undefined) {
        setVideoElements(state.videoElements)
        setSelectedVideoElementSrc('')
      }

      if (state.openedFromMiningCommand !== undefined) {
        setOpenedFromMiningCommand(state.openedFromMiningCommand)
      }
    })
  }, [bridge])

  const handleConfirm = useCallback(() => {
    const message: VideoSelectModeConfirmMessage = {
      command: 'confirm',
      selectedVideoElementSrc,
    }

    bridge.sendMessageFromServer(message)
    setOpen(false)
  }, [bridge, selectedVideoElementSrc])

  const handleOpenSettings = useCallback(() => {
    bridge.sendMessageFromServer({ command: 'openSettings' })
  }, [bridge])
  const handleCancel = useCallback(() => {
    const message: VideoSelectModeCancelMessage = {
      command: 'cancel',
    }
    bridge.sendMessageFromServer(message)
  }, [bridge])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Dialog open={open} fullWidth maxWidth='sm'>
        {videoElements.length > 0 && (
          <>
            <Toolbar>
              <Typography variant='h6' style={{ flexGrow: 1 }}>
                <Trans>Multiple Video Elements Detected</Trans>
              </Typography>
              <IconButton edge='end' onClick={() => handleOpenSettings()}>
                <SettingsIcon />
              </IconButton>
              <IconButton edge='end' onClick={() => handleCancel()}>
                <CloseIcon />
              </IconButton>
            </Toolbar>
            <DialogContent>
              {openedFromMiningCommand ? (
                <DialogContentText>
                  <Trans>
                    A video element must be synced with asbplayer before it can be mined. Select a video element to sync
                    it with asbplayer.
                  </Trans>
                </DialogContentText>
              ) : (
                <DialogContentText>
                  <Trans>Select a video element to sync it with asbplayer.</Trans>
                </DialogContentText>
              )}
              <Grid container direction='column' spacing={2}>
                <Grid item style={{ maxWidth: '100%' }}>
                  <TextField
                    select
                    fullWidth
                    color='primary'
                    variant='filled'
                    label={t`Video Element`}
                    value={selectedVideoElementSrc}
                    onChange={(e) => setSelectedVideoElementSrc(e.target.value)}
                  >
                    {videoElements.map((v) => (
                      <MenuItem value={v.src} key={v.src}>
                        <img style={{ maxWidth: 20, marginRight: 12 }} src={v.imageDataUrl} />
                        {v.src}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item style={{ maxWidth: '100%' }}>
                  {selectedVideoElementSrc !== '' && (
                    <img
                      style={{ width: '100%' }}
                      src={videoElements.find((v) => v.src === selectedVideoElementSrc)!.imageDataUrl}
                    />
                  )}
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleConfirm}>
                <Trans>OK</Trans>
              </Button>
            </DialogActions>
          </>
        )}
        {videoElements.length === 0 && (
          <>
            <Toolbar>
              <Typography variant='h6' style={{ flexGrow: 1 }}>
                <Trans>Error</Trans>
              </Typography>
              <IconButton edge='end' onClick={() => handleCancel()}>
                <CloseIcon />
              </IconButton>
            </Toolbar>
            <DialogContent>
              <DialogContentText>
                <Trans>No videos detected.</Trans>
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCancel}>
                <Trans>OK</Trans>
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </ThemeProvider>
  )
}
