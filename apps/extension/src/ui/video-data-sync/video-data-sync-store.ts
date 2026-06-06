import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { VideoDataSubtitleTrack, VideoDataUiModel, VideoDataUiOpenReason } from '@asbplayer-fork/common'
import type { Profile, ThemeType } from '@asbplayer-fork/common/settings'

// The zustand replacement for the old VideoDataModelChannel: the controller
// pushes partial VideoDataUiModel updates through `updateState` (signature
// kept compatible with the old channel/FrameBridgeClient), the React app reads
// fields through per-field `useStore` selectors. The store holds full state,
// so no late-subscriber replay is needed — React reads getState() on mount.
//
// NEVER a module singleton — each controller instance owns its own store so
// multiple videos / dialogs on a page stay independent.
export interface VideoDataSyncState {
  open: boolean
  isLoading: boolean
  suggestedName: string
  showSubSelect: boolean
  // The raw track list as pushed by the controller plus locally-picked file
  // tracks. The `Empty` placeholder entry is NOT stored here: its label is a
  // lingui translation, so it is derived in React (where `t` lives) — see
  // ShadowVideoDataSyncApp. Selection ids use '-' for the placeholder.
  rawSubtitles: VideoDataSubtitleTrack[]
  selectedSubtitleTrackIds: string[]
  defaultCheckboxState: boolean
  openReason: VideoDataUiOpenReason
  openedFromAsbplayerId: string
  error: string
  themeType: ThemeType
  profiles: Profile[]
  activeProfile: string | undefined
  hasSeenFtue: boolean | undefined
  hideRememberTrackPreferenceToggle: boolean | undefined
  isYouTube: boolean
  canGenerateTranscripts: boolean
  isGeneratingSupadata: boolean
  availableTranslationLanguages: string[]
  defaultTranslationLanguage: string | undefined
  translationMode: 'off' | 'machine' | 'human'

  // Apply a partial model push from the controller — same per-field semantics
  // the old bridge listener implemented in the component.
  updateState: (partial: Partial<VideoDataUiModel>) => void
  // Append locally-picked subtitle file tracks and select the first one in the
  // given slot (the local file-picker path).
  addLocalFileTracks: (tracks: VideoDataSubtitleTrack[], slot: number) => void
}

export type VideoDataSyncStore = StoreApi<VideoDataSyncState>

const initialTrackIds = ['-', '-', '-']

export function createVideoDataSyncStore(): VideoDataSyncStore {
  return createStore<VideoDataSyncState>((set) => ({
    open: false,
    isLoading: true,
    suggestedName: '',
    showSubSelect: true,
    rawSubtitles: [],
    selectedSubtitleTrackIds: initialTrackIds,
    defaultCheckboxState: false,
    openReason: VideoDataUiOpenReason.userRequested,
    openedFromAsbplayerId: '',
    error: '',
    themeType: 'system',
    profiles: [],
    activeProfile: undefined,
    hasSeenFtue: undefined,
    hideRememberTrackPreferenceToggle: undefined,
    isYouTube: false,
    canGenerateTranscripts: false,
    isGeneratingSupadata: false,
    availableTranslationLanguages: [],
    defaultTranslationLanguage: undefined,
    translationMode: 'off',

    updateState: (partial) =>
      set((state) => {
        const next: Partial<VideoDataSyncState> = {}

        if (partial.open !== undefined) {
          next.open = partial.open
        }
        if (partial.isLoading !== undefined) {
          next.isLoading = partial.isLoading
        }
        if (partial.suggestedName !== undefined) {
          next.suggestedName = partial.suggestedName
        }
        if (partial.showSubSelect !== undefined) {
          next.showSubSelect = partial.showSubSelect
        }
        if (partial.subtitles !== undefined) {
          // The pushed list replaces the whole track list (locally-picked file
          // tracks included). Prune selections that no longer resolve to a
          // track — '-' (the Empty placeholder) is always valid.
          next.rawSubtitles = partial.subtitles
          next.selectedSubtitleTrackIds = state.selectedSubtitleTrackIds.map((selectedId) =>
            selectedId === '-' || partial.subtitles!.some((track) => track.id === selectedId) ? selectedId : '-'
          )
        }
        if (partial.selectedSubtitle !== undefined) {
          // Applied after the subtitles prune (the controller pushes both in
          // one partial when it rebuilds the model) — an explicit selection
          // wins, matching the old listener's apply order.
          next.selectedSubtitleTrackIds = partial.selectedSubtitle
        }
        if (partial.defaultCheckboxState !== undefined) {
          next.defaultCheckboxState = partial.defaultCheckboxState
        }
        if (partial.error !== undefined) {
          next.error = partial.error
        }
        if (partial.openReason !== undefined) {
          next.openReason = partial.openReason
        }
        if (partial.openedFromAsbplayerId !== undefined) {
          next.openedFromAsbplayerId = partial.openedFromAsbplayerId
        }
        if (partial.settings !== undefined) {
          next.themeType = (partial.settings.themeType as ThemeType) ?? 'system'
          next.profiles = partial.settings.profiles
          next.activeProfile = partial.settings.activeProfile
        }
        if (partial.hasSeenFtue !== undefined) {
          next.hasSeenFtue = partial.hasSeenFtue
        }
        if (partial.hideRememberTrackPreferenceToggle !== undefined) {
          next.hideRememberTrackPreferenceToggle = partial.hideRememberTrackPreferenceToggle
        }
        if (partial.isYouTube !== undefined) {
          next.isYouTube = partial.isYouTube
        }
        if (partial.canGenerateTranscripts !== undefined) {
          next.canGenerateTranscripts = partial.canGenerateTranscripts
        }
        if (partial.isGeneratingSupadata !== undefined) {
          next.isGeneratingSupadata = partial.isGeneratingSupadata
        }
        if (partial.availableTranslationLanguages !== undefined) {
          next.availableTranslationLanguages = partial.availableTranslationLanguages
        }
        if (partial.defaultTranslationLanguage !== undefined) {
          next.defaultTranslationLanguage = partial.defaultTranslationLanguage
        }
        if (partial.translationMode !== undefined) {
          next.translationMode = partial.translationMode
        }

        return next
      }),

    addLocalFileTracks: (tracks, slot) =>
      set((state) => {
        if (tracks.length === 0) {
          return {}
        }

        const selectedIdsBySlot = [...state.selectedSubtitleTrackIds]
        selectedIdsBySlot[slot] = tracks[0].id

        return {
          rawSubtitles: [...state.rawSubtitles, ...tracks],
          selectedSubtitleTrackIds: selectedIdsBySlot,
        }
      }),
  }))
}
