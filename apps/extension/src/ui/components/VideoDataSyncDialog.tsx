import { InfoIcon, LanguagesIcon, Loader2Icon, SettingsIcon, XIcon } from 'lucide-react'
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
import { useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import MiniProfileSelector from '@asbplayer-fork/common/components/MiniProfileSelector'
import type { Profile } from '@asbplayer-fork/common/settings'

// "fr" -> "French" in the extension UI locale; falls back to the raw code for
// anything Intl.DisplayNames refuses.
const languageDisplayName = (displayNames: Intl.DisplayNames | undefined, code: string): string => {
  try {
    return displayNames?.of(code) ?? code
  } catch {
    return code
  }
}

// The source language a YouTube track transcribes — for already-translated
// variants (`L_from_base`), the base.
const baseLanguageOf = (language: string | undefined): string | undefined => {
  if (language === undefined) {
    return undefined
  }
  return language.includes('_from_') ? language.split('_from_')[1] : language
}

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
  canGenerateTranscripts?: boolean
  isGeneratingSupadata?: boolean
  availableTranslationLanguages?: string[]
  defaultTranslationLanguage?: string
  translationMode?: 'off' | 'machine' | 'human'
  onCancel: () => void
  onOpenFile: (track?: number) => void
  onOpenSettings: () => void
  onConfirm: (
    track: ConfirmedVideoDataSubtitleTrack[],
    shouldRememberTrackChoices: boolean,
    translationMode: 'off' | 'machine' | 'human'
  ) => void
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
  canGenerateTranscripts,
  isGeneratingSupadata,
  availableTranslationLanguages,
  defaultTranslationLanguage,
  translationMode,
  onCancel,
  onOpenFile,
  onOpenSettings,
  onConfirm,
  onSetActiveProfile,
  onDismissFtue,
  onGenerateSupadata,
}: Props) {
  const { t, i18n } = useLingui()
  const [userSelectedSubtitleTrackIds, setUserSelectedSubtitleTrackIds] = useState(['-', '-', '-'])
  const [name, setName] = useState('')
  const [shouldRememberTrackChoices, setShouldRememberTrackChoices] = useState(false)
  // Translation controls (YouTube): the language the toggles act on, plus the
  // two mutually-exclusive source switches.
  const [translationLanguage, setTranslationLanguage] = useState('')
  const [machineTranslationOn, setMachineTranslationOn] = useState(false)
  const [humanTranslationOn, setHumanTranslationOn] = useState(false)
  const trimmedName = name.trim()
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open && !wasOpen.current) {
      // Adopt the controller's auto-selection only when the dialog (re)opens.
      // While it stays open, later pushes must not clobber in-progress
      // selections.
      setUserSelectedSubtitleTrackIds(
        selectedSubtitleTrackIds.map((id, i) => {
          // YouTube renders two selectors; never adopt a track into the hidden
          // third slot (the translation controls own it).
          if (isYouTube && i >= 2) {
            return '-'
          }
          return id !== undefined ? id : '-'
        })
      )
      // Adopt the persisted toggle choice; availability gating still applies
      // (an unavailable source simply contributes nothing on OK).
      setMachineTranslationOn(translationMode === 'machine')
      setHumanTranslationOn(translationMode === 'human')
    } else if (!open) {
      setName('')
    }
    wasOpen.current = open
  }, [open, selectedSubtitleTrackIds, isYouTube, translationMode])

  // Drop selections whose track disappeared from a late track-list push.
  useEffect(() => {
    setUserSelectedSubtitleTrackIds((prev) =>
      prev.map((id) => (id === '-' || subtitleTracks.some((track) => track.id === id) ? id : '-'))
    )
  }, [subtitleTracks])

  // The dropdown default (last used, else native language) can arrive after the
  // dialog opened (the model push with the page's track data carries it) — only
  // ever fill an untouched dropdown.
  useEffect(() => {
    if (defaultTranslationLanguage !== undefined && defaultTranslationLanguage !== '') {
      setTranslationLanguage((current) => (current === '' ? defaultTranslationLanguage : current))
    }
  }, [defaultTranslationLanguage])

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
    const confirmedTranslationMode = machineTranslationOn ? 'machine' : humanTranslationOn ? 'human' : 'off'
    onConfirm(selectedSubtitleTracks, shouldRememberTrackChoices, confirmedTranslationMode)
  }

  function handleRememberTrackChoices() {
    setShouldRememberTrackChoices(!shouldRememberTrackChoices)
  }

  const displayNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([i18n.locale || 'en'], { type: 'language' })
    } catch {
      return undefined
    }
  }, [i18n.locale])

  const translationLanguageOptions = useMemo(() => {
    const codes = [...(availableTranslationLanguages ?? [])]
    if (translationLanguage !== '' && !codes.includes(translationLanguage)) {
      // Keep a stale default (e.g. native language the video doesn't offer)
      // visible rather than showing an empty trigger.
      codes.push(translationLanguage)
    }
    return codes
      .map((code) => ({ code, name: languageDisplayName(displayNames, code) }))
      .sort((a, b) => a.name.localeCompare(b.name, i18n.locale || 'en'))
  }, [availableTranslationLanguages, translationLanguage, displayNames, i18n.locale])

  const primaryTrack = subtitleTracks.find((track) => track.id === userSelectedSubtitleTrackIds[0])
  // Machine translation reuses the primary track's timedtext URL with `tlang`
  // — needs a real YouTube track and a target that differs from the language
  // the track transcribes.
  const machineTranslationAvailable =
    primaryTrack !== undefined &&
    typeof primaryTrack.url === 'string' &&
    primaryTrack.extension === 'ytsrv3' &&
    !primaryTrack.localFile &&
    translationLanguage !== '' &&
    baseLanguageOf(primaryTrack.language)?.split('-')[0] !== translationLanguage.split('-')[0]

  // A human-authored YouTube track in the translation language (manual upload,
  // not ASR, not a `>>` variant) that isn't already the primary selection.
  const humanTranslationTrack =
    translationLanguage === ''
      ? undefined
      : subtitleTracks.find(
          (track) =>
            track.id !== userSelectedSubtitleTrackIds[0] &&
            track.isAutoGenerated !== true &&
            !track.localFile &&
            typeof track.url === 'string' &&
            track.extension === 'ytsrv3' &&
            track.language !== undefined &&
            !track.language.includes('_from_') &&
            track.language.split('-')[0] === translationLanguage.split('-')[0]
        )

  function handleMachineTranslationToggle(on: boolean) {
    setMachineTranslationOn(on)
    if (on) {
      setHumanTranslationOn(false)
    }
  }

  function handleHumanTranslationToggle(on: boolean) {
    setHumanTranslationOn(on)
    if (on) {
      setMachineTranslationOn(false)
    }
  }

  // The extra track the translation toggles contribute on OK.
  function translationTrackForConfirm(): ConfirmedVideoDataSubtitleTrack | undefined {
    if (machineTranslationOn && machineTranslationAvailable && primaryTrack && typeof primaryTrack.url === 'string') {
      const url = new URL(primaryTrack.url)
      url.searchParams.set('tlang', translationLanguage)
      const baseLabel = primaryTrack.label.replace(/ >> .*$/, '')
      const label = `${baseLabel} >> ${languageDisplayName(displayNames, translationLanguage)}`
      return {
        name: calculateVideoName(trimmedName, label, false),
        id: `${primaryTrack.id}:tlang:${translationLanguage}`,
        label,
        language: `${translationLanguage}_from_${baseLanguageOf(primaryTrack.language)}`,
        url: url.toString(),
        extension: primaryTrack.extension,
      }
    }
    if (humanTranslationOn && humanTranslationTrack) {
      return {
        name: calculateVideoName(trimmedName, humanTranslationTrack.label, humanTranslationTrack.localFile),
        ...humanTranslationTrack,
      }
    }
    return undefined
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

    const translationTrack = translationTrackForConfirm()
    if (
      translationTrack !== undefined &&
      !selectedSubtitleTracks.some(
        (track) =>
          track.id === translationTrack.id ||
          (track.language !== undefined && track.language === translationTrack.language)
      )
    ) {
      selectedSubtitleTracks.push(translationTrack)
    }

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

  // On YouTube the third selector's slot is taken by the translation controls.
  const subtitleTrackSelectors = generateSubtitleTrackSelectors(isYouTube ? 2 : 3)
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
                  Auto-detected subtitle tracks can be selected here. Flicktionary does not know how to detect subtitles
                  on every site. You can always load your own subtitle files.
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
          {subtitleTrackSelectors}
          {isYouTube && showSubSelect && (
            <div className='flex flex-col gap-2'>
              <Label className='flex items-center gap-1.5'>
                <LanguagesIcon className='size-4' />
                <Trans>Translation language</Trans>
              </Label>
              <Select
                value={translationLanguage === '' ? undefined : translationLanguage}
                disabled={isLoading || disabled || translationLanguageOptions.length === 0}
                onValueChange={setTranslationLanguage}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder={t`Select a language`} />
                </SelectTrigger>
                <SelectContent>
                  {translationLanguageOptions.map(({ code, name: languageName }) => (
                    <SelectItem value={code} key={code}>
                      <span className='truncate'>{languageName}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className='flex flex-wrap items-center gap-x-6 gap-y-2 pt-1'>
                <Label className='flex items-center gap-2.5'>
                  <Switch
                    checked={machineTranslationOn}
                    disabled={!machineTranslationAvailable || isLoading || disabled}
                    onCheckedChange={handleMachineTranslationToggle}
                  />
                  <Trans>Machine translation</Trans>
                </Label>
                <Label className='flex items-center gap-2.5'>
                  <Switch
                    checked={humanTranslationOn}
                    disabled={humanTranslationTrack === undefined || isLoading || disabled}
                    onCheckedChange={handleHumanTranslationToggle}
                  />
                  <span>
                    <Trans>Human translation</Trans>
                    {humanTranslationTrack === undefined && (
                      <span className='text-muted-foreground'>
                        {' '}
                        (<Trans>not available</Trans>)
                      </span>
                    )}
                  </span>
                </Label>
              </div>
            </div>
          )}
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
          {isYouTube && canGenerateTranscripts && onGenerateSupadata && (
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
