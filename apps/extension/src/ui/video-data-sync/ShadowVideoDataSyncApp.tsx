import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ConfirmedVideoDataSubtitleTrack,
  SerializedSubtitleFile,
  VideoDataSubtitleTrack,
  VideoDataUiModel,
  VideoDataUiOpenReason,
} from '@asbplayer-fork/common'
import { bufferToBase64 } from '@asbplayer-fork/common/base64'
import type { Profile, ThemeType } from '@asbplayer-fork/common/settings'
import { useLingui } from '@lingui/react/macro'
import VideoDataSyncDialog from '../components/VideoDataSyncDialog'
import { ShadowUiProvider } from '../shadow/shadow-ui-provider'

// The in-realm replacement for the FrameBridge model transport. The controller
// pushes partial VideoDataUiModel updates (formerly UpdateStateMessage over the
// bridge); the component applies each delta exactly as VideoDataSyncUi did off
// `bridge.addClientMessageListener`. Late subscribers (the React subscription
// runs after the controller's first updateState) get the accumulated state
// replayed, so no early update is lost.
export class VideoDataModelChannel {
  private listeners = new Set<(partial: Partial<VideoDataUiModel>) => void>()
  private merged: Partial<VideoDataUiModel> = {}

  subscribe = (listener: (partial: Partial<VideoDataUiModel>) => void): (() => void) => {
    this.listeners.add(listener)
    if (Object.keys(this.merged).length > 0) {
      listener(this.merged)
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  // Matches FrameBridgeClient.updateState so the controller can treat the iframe
  // client and this channel interchangeably.
  updateState = (partial: Partial<VideoDataUiModel>): void => {
    this.merged = { ...this.merged, ...partial }
    for (const listener of this.listeners) {
      listener(partial)
    }
  }
}

// The command half of the bridge, now plain callbacks the controller maps to the
// same handlers the iframe onMessage path uses.
export interface VideoDataCommands {
  onOpenSettings: () => void
  onCancel: () => void
  onConfirm: (
    data: ConfirmedVideoDataSubtitleTrack[],
    shouldRememberTrackChoices: boolean,
    translationMode: 'off' | 'machine' | 'human',
    syncWithAsbplayerId?: string
  ) => void
  onOpenFile: (subtitles: SerializedSubtitleFile[]) => void
  onSetActiveProfile: (profile?: string) => void
  onDismissFtue: () => void
  onGenerateSupadata: () => void
}

export interface ShadowVideoDataSyncAppProps {
  channel: VideoDataModelChannel
  shadowRoot: ShadowRoot
  portalContainer: HTMLElement
  language: string
  commands: VideoDataCommands
}

const initialTrackIds = ['-', '-', '-']

// Outer wrapper: provides the ui/I18n/portal context. It reads ONLY themeType
// from the channel (for the theme) — the body's hooks (useLingui) must run
// INSIDE this provider, so they live in VideoDataSyncBody below.
export function ShadowVideoDataSyncApp({ channel, portalContainer, language, commands }: ShadowVideoDataSyncAppProps) {
  // Raw setting value — ShadowUiProvider resolves 'system' in this realm.
  const [themeType, setThemeType] = useState<ThemeType>('system')
  useEffect(
    () =>
      channel.subscribe((model) => {
        if (model.settings?.themeType !== undefined) {
          setThemeType((model.settings.themeType as ThemeType) ?? 'system')
        }
      }),
    [channel]
  )

  return (
    <ShadowUiProvider portalContainer={portalContainer} themeType={themeType} language={language}>
      <VideoDataSyncBody channel={channel} commands={commands} />
    </ShadowUiProvider>
  )
}

function VideoDataSyncBody({ channel, commands }: { channel: VideoDataModelChannel; commands: VideoDataCommands }) {
  const { t } = useLingui()
  const [open, setOpen] = useState<boolean>(false)
  const [disabled, setDisabled] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [suggestedName, setSuggestedName] = useState<string>('')
  const [showSubSelect, setShowSubSelect] = useState<boolean>(true)
  const [subtitles, setSubtitles] = useState<VideoDataSubtitleTrack[]>([
    { id: '-', language: '-', url: '-', label: t`Empty`, extension: 'srt' },
  ])
  const [selectedSubtitleTrackIds, setSelectedSubtitleTrackIds] = useState<string[]>(initialTrackIds)
  const [defaultCheckboxState, setDefaultCheckboxState] = useState<boolean>(false)
  const [openReason, setOpenReason] = useState<VideoDataUiOpenReason>(VideoDataUiOpenReason.userRequested)
  const [openedFromAsbplayerId, setOpenedFromAsbplayerId] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeProfile, setActiveProfile] = useState<string>()
  const [fileInputTrackNumber, setFileInputTrackNumber] = useState<number>()
  const [hasSeenFtue, setHasSeenFtue] = useState<boolean>()
  const [hideRememberTrackPreferenceToggle, setHideRememberTrackPreferenceToggle] = useState<boolean>()
  const [isYouTube, setIsYouTube] = useState<boolean>(false)
  const [canGenerateTranscripts, setCanGenerateTranscripts] = useState<boolean>(false)
  const [isGeneratingSupadata, setIsGeneratingSupadata] = useState<boolean>(false)
  const [availableTranslationLanguages, setAvailableTranslationLanguages] = useState<string[]>([])
  const [defaultTranslationLanguage, setDefaultTranslationLanguage] = useState<string>()
  const [translationMode, setTranslationMode] = useState<'off' | 'machine' | 'human'>('off')

  // Apply each partial model exactly as the bridge listener did in VideoDataSyncUi.
  useEffect(() => {
    return channel.subscribe((model: Partial<VideoDataUiModel>) => {
      if (model.open !== undefined) {
        setOpen(model.open)
      }
      if (model.isLoading !== undefined) {
        setIsLoading(model.isLoading)
      }
      if (model.suggestedName !== undefined) {
        setSuggestedName(model.suggestedName)
      }
      if (model.showSubSelect !== undefined) {
        setShowSubSelect(model.showSubSelect)
      }
      if (model.subtitles !== undefined) {
        const newSubtitles = [
          { id: '-', language: '-', url: '-', label: t`Empty`, extension: 'srt' },
          ...model.subtitles,
        ]
        setSelectedSubtitleTrackIds((currentSelectedTrackIds) =>
          currentSelectedTrackIds.map((currentSelectedTrackId) => {
            const stillSelected = newSubtitles.find((track) => track.id === currentSelectedTrackId)
            return stillSelected ? currentSelectedTrackId : '-'
          })
        )
        setSubtitles(newSubtitles)
      }
      if (model.selectedSubtitle !== undefined) {
        setSelectedSubtitleTrackIds(model.selectedSubtitle)
      }
      if (model.defaultCheckboxState !== undefined) {
        setDefaultCheckboxState(model.defaultCheckboxState)
      }
      if (model.error !== undefined) {
        setError(model.error)
      }
      if (model.openReason !== undefined) {
        setOpenReason(model.openReason)
      }
      if (model.openedFromAsbplayerId !== undefined) {
        setOpenedFromAsbplayerId(model.openedFromAsbplayerId)
      }
      if (model.settings !== undefined) {
        // themeType is handled by the outer wrapper (it drives ShadowMuiProvider).
        setProfiles(model.settings.profiles)
        setActiveProfile(model.settings.activeProfile)
      }
      if (model.hasSeenFtue !== undefined) {
        setHasSeenFtue(model.hasSeenFtue)
      }
      if (model.hideRememberTrackPreferenceToggle !== undefined) {
        setHideRememberTrackPreferenceToggle(model.hideRememberTrackPreferenceToggle)
      }
      if (model.isYouTube !== undefined) {
        setIsYouTube(model.isYouTube)
      }
      if (model.canGenerateTranscripts !== undefined) {
        setCanGenerateTranscripts(model.canGenerateTranscripts)
      }
      if (model.isGeneratingSupadata !== undefined) {
        setIsGeneratingSupadata(model.isGeneratingSupadata)
      }
      if (model.availableTranslationLanguages !== undefined) {
        setAvailableTranslationLanguages(model.availableTranslationLanguages)
      }
      if (model.defaultTranslationLanguage !== undefined) {
        setDefaultTranslationLanguage(model.defaultTranslationLanguage)
      }
      if (model.translationMode !== undefined) {
        setTranslationMode(model.translationMode)
      }
    })
  }, [channel, t])

  const handleOpenSettings = useCallback(() => commands.onOpenSettings(), [commands])

  const handleCancel = useCallback(() => {
    setOpen(false)
    commands.onCancel()
  }, [commands])

  const handleConfirm = useCallback(
    (
      data: ConfirmedVideoDataSubtitleTrack[],
      shouldRememberTrackChoices: boolean,
      confirmedTranslationMode: 'off' | 'machine' | 'human'
    ) => {
      setOpen(false)
      commands.onConfirm(
        data,
        shouldRememberTrackChoices,
        confirmedTranslationMode,
        openedFromAsbplayerId.length > 0 ? openedFromAsbplayerId : undefined
      )
    },
    [commands, openedFromAsbplayerId]
  )

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileInputChange = useCallback(async () => {
    const files = fileInputRef.current?.files

    if (files && files.length > 0) {
      try {
        setDisabled(true)

        if (fileInputTrackNumber === undefined) {
          const serialized: SerializedSubtitleFile[] = []

          for (let i = 0; i < files.length; ++i) {
            const f = files[i]
            const base64 = await bufferToBase64(await f.arrayBuffer())
            serialized.push({ name: f.name, base64 })
          }

          setOpen(false)
          commands.onOpenFile(serialized)
        } else {
          const fileTracks: VideoDataSubtitleTrack[] = [...files].map((f) => {
            const url = URL.createObjectURL(f)
            const extension = f.name.substring(f.name.lastIndexOf('.') + 1, f.name.length)
            return { label: f.name, id: url, url, extension, localFile: true }
          })

          if (fileTracks.length > 0) {
            setSubtitles((s) => [...s, ...fileTracks])
            setSelectedSubtitleTrackIds((s) => {
              const selectedIdsByTrackNumber = [...s]
              selectedIdsByTrackNumber[fileInputTrackNumber] = fileTracks[0].id
              return selectedIdsByTrackNumber
            })
          }
        }
      } finally {
        setDisabled(false)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    }
  }, [commands, fileInputTrackNumber])

  const handleOpenFile = useCallback((track?: number) => {
    setFileInputTrackNumber(track)
    fileInputRef.current?.click()
  }, [])

  const handleSetActiveProfile = useCallback(
    (profile: string | undefined) => commands.onSetActiveProfile(profile),
    [commands]
  )

  const handleDismissFtue = useCallback(() => {
    setHasSeenFtue(true)
    commands.onDismissFtue()
  }, [commands])

  const handleGenerateSupadata = useCallback(() => commands.onGenerateSupadata(), [commands])

  return (
    <>
      <VideoDataSyncDialog
        open={open}
        disabled={disabled}
        isLoading={isLoading}
        suggestedName={suggestedName}
        showSubSelect={showSubSelect}
        subtitleTracks={subtitles}
        selectedSubtitleTrackIds={selectedSubtitleTrackIds}
        defaultCheckboxState={defaultCheckboxState}
        openReason={openReason}
        error={error}
        profiles={profiles}
        activeProfile={activeProfile}
        hasSeenFtue={hasSeenFtue}
        hideRememberTrackPreferenceToggle={hideRememberTrackPreferenceToggle}
        isYouTube={isYouTube}
        canGenerateTranscripts={canGenerateTranscripts}
        isGeneratingSupadata={isGeneratingSupadata}
        availableTranslationLanguages={availableTranslationLanguages}
        defaultTranslationLanguage={defaultTranslationLanguage}
        translationMode={translationMode}
        onCancel={handleCancel}
        onOpenFile={handleOpenFile}
        onOpenSettings={handleOpenSettings}
        onConfirm={handleConfirm}
        onSetActiveProfile={handleSetActiveProfile}
        onDismissFtue={handleDismissFtue}
        onGenerateSupadata={handleGenerateSupadata}
      />
      <input
        ref={fileInputRef}
        onChange={handleFileInputChange}
        type='file'
        accept='.srt,.ass,.vtt,.dfxp,.ttml2'
        multiple
        hidden
      />
    </>
  )
}
