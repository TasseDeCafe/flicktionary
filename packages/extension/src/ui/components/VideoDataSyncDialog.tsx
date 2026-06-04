import { InfoIcon, Loader2Icon, SettingsIcon, XIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@flicktionary/ui/components/dialog'
import { Button } from '@flicktionary/ui/components/button'
import { Label } from '@flicktionary/ui/components/label'
import { Switch } from '@flicktionary/ui/components/switch'
import { Textarea } from '@flicktionary/ui/components/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@flicktionary/ui/components/select'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { ConfirmedVideoDataSubtitleTrack, VideoDataSubtitleTrack, VideoDataUiOpenReason } from '@asbplayer-fork/common'
import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import MiniProfileSelector from '@asbplayer-fork/common/components/MiniProfileSelector'
import type { Profile } from '@asbplayer-fork/common/settings'

// Sentinel value for the action item at the bottom of each track select.
// Radix select items must carry a non-empty unique value; this one is
// intercepted in onValueChange and never stored as a selection.
const OPEN_FILES_VALUE = '__open-files__'

// An auto-calculated video name based on selected track
function calculateVideoName(baseName: string, label: string, localFile: boolean | undefined) {
  if (baseName === '' && label) {
    return label
  }

  if (label && !baseName.includes(label) && localFile !== true) {
    return `${baseName} - ${label}`
  }

  return baseName
}

interface Props {
  open: boolean
  disabled: boolean
  isLoading: boolean
  // The video name automatically supplied by asbplayer's content script
  // Not to be confused with the auto-calculated video name when user selects a subtitle track
  suggestedName: string
  showSubSelect: boolean
  subtitleTracks: VideoDataSubtitleTrack[]
  selectedSubtitleTrackIds: string[]
  defaultCheckboxState: boolean
  error: string
  openReason: VideoDataUiOpenReason
  profiles: Profile[]
  activeProfile?: string
  hasSeenFtue?: boolean
  hideRememberTrackPreferenceToggle?: boolean
  isYouTube?: boolean
  supadataApiKeyConfigured?: boolean
  isGeneratingSupadata?: boolean
  onCancel: () => void
  onOpenFile: (track?: number) => void
  onOpenSettings: () => void
  onConfirm: (track: ConfirmedVideoDataSubtitleTrack[], shouldRememberTrackChoices: boolean) => void
  onSetActiveProfile: (profile: string | undefined) => void
  onDismissFtue: () => void
  onGenerateSupadata?: () => void
}

export default function VideoDataSyncDialog({
  open,
  disabled,
  isLoading,
  suggestedName,
  showSubSelect,
  subtitleTracks,
  selectedSubtitleTrackIds,
  defaultCheckboxState,
  error,
  openReason,
  profiles,
  activeProfile,
  hasSeenFtue,
  hideRememberTrackPreferenceToggle,
  isYouTube,
  supadataApiKeyConfigured,
  isGeneratingSupadata,
  onCancel,
  onOpenFile,
  onOpenSettings,
  onConfirm,
  onSetActiveProfile,
  onDismissFtue,
  onGenerateSupadata,
}: Props) {
  const { t } = useLingui()
  const [userSelectedSubtitleTrackIds, setUserSelectedSubtitleTrackIds] = useState(['-', '-', '-'])
  const [name, setName] = useState('')
  const [shouldRememberTrackChoices, setShouldRememberTrackChoices] = useState(false)
  const trimmedName = name.trim()

  useEffect(() => {
    if (open) {
      setUserSelectedSubtitleTrackIds(
        selectedSubtitleTrackIds.map((id) => {
          return id !== undefined ? id : '-'
        })
      )
    } else if (!open) {
      setName('')
    }
  }, [open, selectedSubtitleTrackIds])

  useEffect(() => {
    if (open) {
      setShouldRememberTrackChoices(defaultCheckboxState)
    }
  }, [open, defaultCheckboxState])

  useEffect(() => {
    setName((name) => {
      if (!subtitleTracks) {
        // Unable to calculate the video name
        return name
      }

      // If the video name is not calculated yet,
      // or has already been calculated and not changed by the user,
      // then calculate it (possibly again)
      if (
        !name ||
        name === suggestedName ||
        subtitleTracks.find(
          (track) => track.url !== '-' && name === calculateVideoName(suggestedName, track.label, track.localFile)
        )
      ) {
        const selectedTrack = subtitleTracks.find((track) => track.id === userSelectedSubtitleTrackIds[0])

        if (selectedTrack === undefined || selectedTrack.url === '-') {
          return suggestedName
        }

        return calculateVideoName(suggestedName, selectedTrack.label, selectedTrack.localFile)
      }

      // Otherwise, let the name be whatever the user set it to
      return name
    })
  }, [suggestedName, userSelectedSubtitleTrackIds, subtitleTracks])

  function handleOkButtonClick() {
    const selectedSubtitleTracks: ConfirmedVideoDataSubtitleTrack[] = allSelectedSubtitleTracks()
    onConfirm(selectedSubtitleTracks, shouldRememberTrackChoices)
  }

  function handleRememberTrackChoices() {
    setShouldRememberTrackChoices(!shouldRememberTrackChoices)
  }

  function allSelectedSubtitleTracks() {
    const selectedSubtitleTracks: ConfirmedVideoDataSubtitleTrack[] = userSelectedSubtitleTrackIds
      .map((selected): ConfirmedVideoDataSubtitleTrack | undefined => {
        const subtitle = subtitleTracks.find((subtitle) => subtitle.id === selected)
        if (subtitle) {
          const { localFile, label } = subtitle
          const trackName = localFile
            ? // Remove extension. The content script will add it back when rendering the file name on top of the video.
              label.substring(0, label.lastIndexOf('.'))
            : calculateVideoName(trimmedName, label, localFile)

          return {
            name: trackName,
            ...subtitle,
          }
        }
      })
      .filter((track): track is ConfirmedVideoDataSubtitleTrack => track !== undefined)

    return selectedSubtitleTracks
  }

  function generateSubtitleTrackSelectors(numberOfSubtitleTrackSelectors: number) {
    const subtitleTrackSelectors = []
    for (let i = 0; i < numberOfSubtitleTrackSelectors; i++) {
      subtitleTrackSelectors.push(
        <div key={i} className={cn('relative flex w-full flex-col gap-2', !showSubSelect && 'hidden')}>
          <Label>{t`Subtitle Track ${i + 1}`}</Label>
          <Select
            value={subtitleTracks.find((track) => track.id === userSelectedSubtitleTrackIds[i])?.id ?? '-'}
            disabled={isLoading || disabled}
            onValueChange={(value) => {
              if (value === OPEN_FILES_VALUE) {
                onOpenFile(i)
                return
              }
              setUserSelectedSubtitleTrackIds((prevSelectedSubtitles) => {
                const newSelectedSubtitles = [...prevSelectedSubtitles]
                newSelectedSubtitles[i] = value
                return newSelectedSubtitles
              })
            }}
          >
            <SelectTrigger className={cn('w-full', !!error && 'border-destructive')}>
              <SelectValue />
              {isLoading && <Loader2Icon className='size-4 animate-spin' />}
            </SelectTrigger>
            <SelectContent>
              {subtitleTracks.map((subtitle) => (
                <SelectItem value={subtitle.id} key={subtitle.id}>
                  <span className='truncate'>{subtitle.label}</span>
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={OPEN_FILES_VALUE}>
                <Trans>Open Files</Trans>
              </SelectItem>
            </SelectContent>
          </Select>
          {!!error && <p className='text-destructive text-sm'>{error}</p>}
        </div>
      )
    }
    return subtitleTrackSelectors
  }

  const threeSubtitleTrackSelectors = generateSubtitleTrackSelectors(3)
  const okButtonRef = useRef<HTMLButtonElement>(null)
  const videoNameRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Focus OK once the name is ready, but never steal focus while the user is
    // editing the name field. document.activeElement only reports the shadow
    // HOST from inside a shadow tree, so resolve the active element through the
    // field's own root node (works for both Document and ShadowRoot).
    const rootNode = videoNameRef.current?.getRootNode() as Document | ShadowRoot | undefined
    const editingName =
      videoNameRef.current !== null &&
      rootNode?.activeElement !== null &&
      rootNode?.activeElement !== undefined &&
      videoNameRef.current?.contains(rootNode.activeElement)

    if (open && trimmedName && !editingName && !disabled) {
      okButtonRef.current?.focus()
    }
  }, [open, trimmedName, disabled])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel()
        }
      }}
    >
      {/* The header carries its own profile/settings/close controls (the MUI
          Toolbar layout), so the built-in close button is disabled.
          aria-describedby: Radix auto-points it at a description id even when
          we render none (plain userRequested opens) — drop it then. The
          console warnings Radix still emits in shadow roots are false
          positives: its checks use document.getElementById, which can't see
          into shadow trees, while the actual IDREFs resolve fine there. */}
      <DialogContent
        showCloseButton={false}
        {...(openReason === VideoDataUiOpenReason.userRequested ? { 'aria-describedby': undefined } : {})}
      >
        <div className='flex min-w-0 items-center gap-1'>
          <DialogTitle className='flex-1'>
            <Trans>Select Subtitles</Trans>
          </DialogTitle>
          <MiniProfileSelector
            profiles={profiles}
            activeProfile={activeProfile}
            onSetActiveProfile={onSetActiveProfile}
          />
          <Button variant='ghost' size='icon' onClick={onOpenSettings}>
            <SettingsIcon />
            <span className='sr-only'>
              <Trans>Settings</Trans>
            </span>
          </Button>
          <Button variant='ghost' size='icon' onClick={() => onCancel()}>
            <XIcon />
            <span className='sr-only'>
              <Trans>Close</Trans>
            </span>
          </Button>
        </div>
        {openReason === VideoDataUiOpenReason.miningCommand && (
          <DialogDescription>
            <Trans>Subtitles must be loaded before you can start mining.</Trans>
          </DialogDescription>
        )}
        {openReason === VideoDataUiOpenReason.failedToAutoLoadPreferredTrack && (
          <DialogDescription>
            <Trans>Could not auto-load subtitles in your preferred language.</Trans>
          </DialogDescription>
        )}
        <form className='flex min-w-0 flex-col gap-4'>
          {!hasSeenFtue && (
            <div className='bg-muted/50 flex items-start gap-3 rounded-md border p-3'>
              <InfoIcon className='text-muted-foreground mt-0.5 size-4 shrink-0' />
              <p className='flex-1 text-sm'>
                <Trans>
                  Auto-detected subtitle tracks can be selected here. Flicktionary does not know how to detect
                  subtitles on every site. You can always load your own subtitle files.
                </Trans>
              </p>
              {/* type=button: inside the form, the default submit type would
                  reload the host page on click. */}
              <Button type='button' variant='ghost' size='sm' onClick={onDismissFtue}>
                <Trans>OK</Trans>
              </Button>
            </div>
          )}
          <div className='flex flex-col gap-2'>
            <Label htmlFor='video-data-sync-name'>{t`Video Name`}</Label>
            <Textarea
              id='video-data-sync-name'
              ref={videoNameRef}
              className='min-h-9'
              value={name}
              disabled={disabled}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {threeSubtitleTrackSelectors}
          {!hideRememberTrackPreferenceToggle && (
            <Label className='ml-auto flex w-fit items-center gap-3'>
              <Trans>Remember these track choices for this site</Trans>
              <Switch checked={shouldRememberTrackChoices} onCheckedChange={handleRememberTrackChoices} />
            </Label>
          )}
        </form>
        <DialogFooter>
          <Button variant='ghost' disabled={disabled} onClick={() => onOpenFile()}>
            <Trans>Open Files</Trans>
          </Button>
          {isYouTube && supadataApiKeyConfigured && onGenerateSupadata && (
            <Button variant='ghost' disabled={disabled || isGeneratingSupadata} onClick={onGenerateSupadata}>
              {isGeneratingSupadata ? (
                <>
                  <Loader2Icon className='size-4 animate-spin' />
                  <Trans>Generating...</Trans>
                </>
              ) : (
                <Trans>Generate Subtitles</Trans>
              )}
            </Button>
          )}
          <Button variant='ghost' ref={okButtonRef} disabled={!trimmedName || disabled} onClick={handleOkButtonClick}>
            <Trans>OK</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
