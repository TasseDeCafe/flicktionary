import { useCallback, useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
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
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import type { PaletteMode } from '@mui/material/styles'
import { usePortalContainer } from '@asbplayer-fork/common/components/portal-container-context'
import { ShadowMuiProvider } from '../shadow/ShadowMuiProvider'
import { UpdateChannel } from '../shadow/model-store'

// One detected <video> on the page, with a cropped screenshot for the picker.
export interface VideoElement {
  src: string
  imageDataUrl: string
}

// The in-realm model (pushed as partials by the controller, formerly
// UpdateStateMessage over the FrameBridge).
export interface VideoSelectState {
  open: boolean
  themeType: PaletteMode
  videoElements: VideoElement[]
  openedFromMiningCommand: boolean
}

export interface VideoSelectCommands {
  onConfirm: (selectedVideoElementSrc: string) => void
  onOpenSettings: () => void
  onCancel: () => void
}

export interface ShadowVideoSelectAppProps {
  channel: UpdateChannel<VideoSelectState>
  shadowRoot: ShadowRoot
  portalContainer: HTMLElement
  language: string
  commands: VideoSelectCommands
}

// Outer wrapper: provides the MUI/emotion/I18n context. It reads ONLY themeType
// from the channel — the body's hooks (useLingui, MUI portals) must run INSIDE
// this provider, so they live in VideoSelectBody below.
export function ShadowVideoSelectApp({
  channel,
  shadowRoot,
  portalContainer,
  language,
  commands,
}: ShadowVideoSelectAppProps) {
  const [themeType, setThemeType] = useState<PaletteMode>('dark')
  useEffect(
    () =>
      channel.subscribe((state) => {
        if (state.themeType !== undefined) {
          setThemeType(state.themeType)
        }
      }),
    [channel]
  )

  return (
    <ShadowMuiProvider
      shadowRoot={shadowRoot}
      portalContainer={portalContainer}
      themeType={themeType}
      language={language}
    >
      <VideoSelectBody channel={channel} commands={commands} />
    </ShadowMuiProvider>
  )
}

function VideoSelectBody({
  channel,
  commands,
}: {
  channel: UpdateChannel<VideoSelectState>
  commands: VideoSelectCommands
}) {
  const { t } = useLingui()
  const [open, setOpen] = useState<boolean>(false)
  const [videoElements, setVideoElements] = useState<VideoElement[]>([])
  const [selectedVideoElementSrc, setSelectedVideoElementSrc] = useState<string>('')
  const [openedFromMiningCommand, setOpenedFromMiningCommand] = useState<boolean>(false)

  // Apply each partial model exactly as VideoSelectUi's bridge listener did
  // (themeType is handled by the outer wrapper).
  useEffect(() => {
    return channel.subscribe((state: Partial<VideoSelectState>) => {
      if (state.open !== undefined) {
        setOpen(state.open)
      }
      if (state.videoElements !== undefined) {
        setVideoElements(state.videoElements)
        setSelectedVideoElementSrc('')
      }
      if (state.openedFromMiningCommand !== undefined) {
        setOpenedFromMiningCommand(state.openedFromMiningCommand)
      }
    })
  }, [channel])

  const handleConfirm = useCallback(() => {
    commands.onConfirm(selectedVideoElementSrc)
    setOpen(false)
  }, [commands, selectedVideoElementSrc])

  const handleOpenSettings = useCallback(() => commands.onOpenSettings(), [commands])
  const handleCancel = useCallback(() => commands.onCancel(), [commands])

  return (
    <VideoSelectContent
      open={open}
      videoElements={videoElements}
      selectedVideoElementSrc={selectedVideoElementSrc}
      openedFromMiningCommand={openedFromMiningCommand}
      onSelect={setSelectedVideoElementSrc}
      onConfirm={handleConfirm}
      onOpenSettings={handleOpenSettings}
      onCancel={handleCancel}
      label={t`Video Element`}
    />
  )
}

interface ContentProps {
  open: boolean
  videoElements: VideoElement[]
  selectedVideoElementSrc: string
  openedFromMiningCommand: boolean
  onSelect: (src: string) => void
  onConfirm: () => void
  onOpenSettings: () => void
  onCancel: () => void
  label: string
}

function VideoSelectContent({
  open,
  videoElements,
  selectedVideoElementSrc,
  openedFromMiningCommand,
  onSelect,
  onConfirm,
  onOpenSettings,
  onCancel,
  label,
}: ContentProps) {
  const portalContainer = usePortalContainer()

  return (
    <Dialog open={open} container={portalContainer} fullWidth maxWidth='sm'>
      {videoElements.length > 0 && (
        <>
          <Toolbar>
            <Typography variant='h6' style={{ flexGrow: 1 }}>
              <Trans>Multiple Video Elements Detected</Trans>
            </Typography>
            <IconButton edge='end' onClick={() => onOpenSettings()}>
              <SettingsIcon />
            </IconButton>
            <IconButton edge='end' onClick={() => onCancel()}>
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
                  label={label}
                  SelectProps={{ MenuProps: { container: portalContainer } }}
                  value={selectedVideoElementSrc}
                  onChange={(e) => onSelect(e.target.value)}
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
            <Button onClick={onConfirm}>
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
            <IconButton edge='end' onClick={() => onCancel()}>
              <CloseIcon />
            </IconButton>
          </Toolbar>
          <DialogContent>
            <DialogContentText>
              <Trans>No videos detected.</Trans>
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={onCancel}>
              <Trans>OK</Trans>
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
