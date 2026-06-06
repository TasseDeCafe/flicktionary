import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { ConfirmedVideoDataSubtitleTrack, SerializedSubtitleFile, VideoDataSubtitleTrack } from '@asbplayer-fork/common'
import { bufferToBase64 } from '@asbplayer-fork/common/base64'
import { useLingui } from '@lingui/react/macro'
import VideoDataSyncDialog from '../components/VideoDataSyncDialog'
import { ShadowUiProvider } from '../shadow/shadow-ui-provider'
import type { VideoDataSyncStore } from './video-data-sync-store'

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
  store: VideoDataSyncStore
  shadowRoot: ShadowRoot
  portalContainer: HTMLElement
  language: string
  commands: VideoDataCommands
}

// Outer wrapper: provides the ui/I18n/portal context. It reads ONLY themeType
// from the store (for the theme) — the body's hooks (useLingui) must run
// INSIDE this provider, so they live in VideoDataSyncBody below.
export function ShadowVideoDataSyncApp({ store, portalContainer, language, commands }: ShadowVideoDataSyncAppProps) {
  // Raw setting value — ShadowUiProvider resolves 'system' in this realm.
  const themeType = useStore(store, (s) => s.themeType)

  return (
    <ShadowUiProvider portalContainer={portalContainer} themeType={themeType} language={language}>
      <VideoDataSyncBody store={store} commands={commands} />
    </ShadowUiProvider>
  )
}

function VideoDataSyncBody({ store, commands }: { store: VideoDataSyncStore; commands: VideoDataCommands }) {
  const { t } = useLingui()

  const open = useStore(store, (s) => s.open)
  const isLoading = useStore(store, (s) => s.isLoading)
  const suggestedName = useStore(store, (s) => s.suggestedName)
  const showSubSelect = useStore(store, (s) => s.showSubSelect)
  const rawSubtitles = useStore(store, (s) => s.rawSubtitles)
  const selectedSubtitleTrackIds = useStore(store, (s) => s.selectedSubtitleTrackIds)
  const defaultCheckboxState = useStore(store, (s) => s.defaultCheckboxState)
  const openReason = useStore(store, (s) => s.openReason)
  const openedFromAsbplayerId = useStore(store, (s) => s.openedFromAsbplayerId)
  const error = useStore(store, (s) => s.error)
  const profiles = useStore(store, (s) => s.profiles)
  const activeProfile = useStore(store, (s) => s.activeProfile)
  const hasSeenFtue = useStore(store, (s) => s.hasSeenFtue)
  const hideRememberTrackPreferenceToggle = useStore(store, (s) => s.hideRememberTrackPreferenceToggle)
  const isYouTube = useStore(store, (s) => s.isYouTube)
  const canGenerateTranscripts = useStore(store, (s) => s.canGenerateTranscripts)
  const isGeneratingSupadata = useStore(store, (s) => s.isGeneratingSupadata)
  const availableTranslationLanguages = useStore(store, (s) => s.availableTranslationLanguages)
  const defaultTranslationLanguage = useStore(store, (s) => s.defaultTranslationLanguage)
  const translationMode = useStore(store, (s) => s.translationMode)

  // Pure form state — never pushed by the controller.
  const [disabled, setDisabled] = useState<boolean>(false)
  const [fileInputTrackNumber, setFileInputTrackNumber] = useState<number>()

  // The Empty placeholder lives here, not in the store: its label is a lingui
  // translation and `t` changes identity when the locale (re)activates shortly
  // after boot — a late change only re-derives this memo and can never drop
  // store state.
  const subtitles = useMemo(
    () => [{ id: '-', language: '-', url: '-', label: t`Empty`, extension: 'srt' }, ...rawSubtitles],
    [rawSubtitles, t]
  )

  const handleOpenSettings = useCallback(() => commands.onOpenSettings(), [commands])

  const handleCancel = useCallback(() => {
    store.getState().updateState({ open: false })
    commands.onCancel()
  }, [store, commands])

  const handleConfirm = useCallback(
    (
      data: ConfirmedVideoDataSubtitleTrack[],
      shouldRememberTrackChoices: boolean,
      confirmedTranslationMode: 'off' | 'machine' | 'human'
    ) => {
      store.getState().updateState({ open: false })
      commands.onConfirm(
        data,
        shouldRememberTrackChoices,
        confirmedTranslationMode,
        openedFromAsbplayerId.length > 0 ? openedFromAsbplayerId : undefined
      )
    },
    [store, commands, openedFromAsbplayerId]
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

          store.getState().updateState({ open: false })
          commands.onOpenFile(serialized)
        } else {
          const fileTracks: VideoDataSubtitleTrack[] = [...files].map((f) => {
            const url = URL.createObjectURL(f)
            const extension = f.name.substring(f.name.lastIndexOf('.') + 1, f.name.length)
            return { label: f.name, id: url, url, extension, localFile: true }
          })

          store.getState().addLocalFileTracks(fileTracks, fileInputTrackNumber)
        }
      } finally {
        setDisabled(false)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    }
  }, [store, commands, fileInputTrackNumber])

  const handleOpenFile = useCallback((track?: number) => {
    setFileInputTrackNumber(track)
    fileInputRef.current?.click()
  }, [])

  const handleSetActiveProfile = useCallback(
    (profile: string | undefined) => commands.onSetActiveProfile(profile),
    [commands]
  )

  const handleDismissFtue = useCallback(() => {
    store.getState().updateState({ hasSeenFtue: true })
    commands.onDismissFtue()
  }, [store, commands])

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
