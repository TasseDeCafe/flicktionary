import { useCallback, useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { SettingsIcon, XIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@flicktionary/ui/components/dialog'
import { Button } from '@flicktionary/ui/components/button'
import { Label } from '@flicktionary/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@flicktionary/ui/components/select'
import { ShadowUiProvider } from '../shadow/shadow-ui-provider'
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
  themeType: 'dark' | 'light'
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

// Outer wrapper: provides the ui/I18n/portal context. It reads ONLY themeType
// from the channel — the body's hooks (useLingui) must run INSIDE this
// provider, so they live in VideoSelectBody below.
export function ShadowVideoSelectApp({ channel, portalContainer, language, commands }: ShadowVideoSelectAppProps) {
  const [themeType, setThemeType] = useState<'dark' | 'light'>('dark')
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
    <ShadowUiProvider portalContainer={portalContainer} themeType={themeType} language={language}>
      <VideoSelectBody channel={channel} commands={commands} />
    </ShadowUiProvider>
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
  // Index into videoElements as a string ('' = no selection) — see the
  // SelectItem comment for why values are indices rather than srcs.
  const [selectedIndex, setSelectedIndex] = useState<string>('')
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
        setSelectedIndex('')
      }
      if (state.openedFromMiningCommand !== undefined) {
        setOpenedFromMiningCommand(state.openedFromMiningCommand)
      }
    })
  }, [channel])

  const selectedVideoElement = selectedIndex === '' ? undefined : videoElements[Number(selectedIndex)]

  const handleConfirm = useCallback(() => {
    if (selectedVideoElement === undefined) {
      return
    }
    commands.onConfirm(selectedVideoElement.src)
    setOpen(false)
  }, [commands, selectedVideoElement])

  const handleOpenSettings = useCallback(() => commands.onOpenSettings(), [commands])
  const handleCancel = useCallback(() => commands.onCancel(), [commands])

  return (
    <VideoSelectContent
      open={open}
      videoElements={videoElements}
      selectedIndex={selectedIndex}
      selectedVideoElement={selectedVideoElement}
      openedFromMiningCommand={openedFromMiningCommand}
      onSelectIndex={setSelectedIndex}
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
  selectedIndex: string
  selectedVideoElement: VideoElement | undefined
  openedFromMiningCommand: boolean
  onSelectIndex: (index: string) => void
  onConfirm: () => void
  onOpenSettings: () => void
  onCancel: () => void
  label: string
}

function VideoSelectContent({
  open,
  videoElements,
  selectedIndex,
  selectedVideoElement,
  openedFromMiningCommand,
  onSelectIndex,
  onConfirm,
  onOpenSettings,
  onCancel,
  label,
}: ContentProps) {
  const hasVideos = videoElements.length > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel()
        }
      }}
    >
      {/* The header carries its own settings + close icon buttons (the MUI
          Toolbar layout), so the built-in close button is disabled. */}
      <DialogContent showCloseButton={false}>
        <div className='flex items-center gap-1'>
          <DialogTitle className='flex-1'>
            {hasVideos ? <Trans>Multiple Video Elements Detected</Trans> : <Trans>Error</Trans>}
          </DialogTitle>
          {hasVideos && (
            <Button variant='ghost' size='icon' onClick={onOpenSettings}>
              <SettingsIcon />
              <span className='sr-only'>
                <Trans>Settings</Trans>
              </span>
            </Button>
          )}
          <Button variant='ghost' size='icon' onClick={onCancel}>
            <XIcon />
            <span className='sr-only'>
              <Trans>Close</Trans>
            </span>
          </Button>
        </div>
        {hasVideos ? (
          <>
            <DialogDescription>
              {openedFromMiningCommand ? (
                <Trans>
                  A video element must be synced with Flicktionary before it can be mined. Select a video element to
                  sync it with Flicktionary.
                </Trans>
              ) : (
                <Trans>Select a video element to sync it with Flicktionary.</Trans>
              )}
            </DialogDescription>
            {/* min-w-0: the select trigger renders a whitespace-nowrap blob:
                URL; without it this grid item's min-content width blows the
                track past the dialog's max-width and every row bleeds out of
                the painted box. */}
            <div className='flex min-w-0 flex-col gap-4'>
              <div className='flex flex-col gap-2'>
                <Label>{label}</Label>
                {/* Items are keyed by INDEX, not src: a Radix SelectItem throws
                    on an empty-string value, and pages with
                    allowVideoElementsWithBlankSrc legitimately produce src ''.
                    (The empty string doubles as the no-selection sentinel.) */}
                <Select value={selectedIndex} onValueChange={onSelectIndex}>
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder={<Trans>Select a video element…</Trans>} />
                  </SelectTrigger>
                  <SelectContent>
                    {videoElements.map((v, i) => (
                      <SelectItem value={String(i)} key={i}>
                        <img className='max-w-5 shrink-0' src={v.imageDataUrl} alt='' />
                        <span className='truncate'>{v.src}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedVideoElement && (
                <img className='w-full rounded-md' alt='' src={selectedVideoElement.imageDataUrl} />
              )}
            </div>
            <DialogFooter>
              <Button variant='ghost' onClick={onConfirm} disabled={selectedVideoElement === undefined}>
                <Trans>OK</Trans>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogDescription>
              <Trans>No videos detected.</Trans>
            </DialogDescription>
            <DialogFooter>
              <Button variant='ghost' onClick={onCancel}>
                <Trans>OK</Trans>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
