import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import type { ThemeType } from '@asbplayer-fork/common/settings'

// One detected <video> on the page, with a cropped screenshot for the picker.
export interface VideoElement {
  src: string
  imageDataUrl: string
}

// The model the controller pushes as partials (formerly UpdateStateMessage
// over the FrameBridge, then the UpdateChannel).
export interface VideoSelectState {
  open: boolean
  // Raw setting value — ShadowUiProvider resolves 'system' in this realm.
  themeType: ThemeType
  videoElements: VideoElement[]
  openedFromMiningCommand: boolean
}

// The zustand replacement for the old UpdateChannel: the controller pushes
// partial VideoSelectState updates through `updateState` (same signature), the
// React app reads fields through `useStore` selectors. The store holds full
// state, so no late-subscriber replay is needed — the dialog reads getState()
// on mount, which covers the first-trigger open that used to rely on replay.
//
// NEVER a module singleton — the controller owns one store per page.
export interface VideoSelectStoreState extends VideoSelectState {
  // Index into videoElements as a string ('' = no selection) — see the
  // SelectItem comment in ShadowVideoSelectApp for why values are indices
  // rather than srcs. Lives in the store (not React state) so a videoElements
  // delta can atomically reset it: a selector-only migration would leave a
  // stale index pointing at the wrong video.
  selectedIndex: string

  updateState: (partial: Partial<VideoSelectState>) => void
  setSelectedIndex: (index: string) => void
}

export type VideoSelectStore = StoreApi<VideoSelectStoreState>

export function createVideoSelectStore(): VideoSelectStore {
  return createStore<VideoSelectStoreState>((set) => ({
    open: false,
    themeType: 'system',
    videoElements: [],
    openedFromMiningCommand: false,
    selectedIndex: '',

    updateState: (partial) =>
      set(() => {
        const next: Partial<VideoSelectStoreState> = {}
        if (partial.open !== undefined) {
          next.open = partial.open
        }
        if (partial.themeType !== undefined) {
          next.themeType = partial.themeType
        }
        if (partial.videoElements !== undefined) {
          // A new video list invalidates the previous selection (the indices
          // would point at different videos).
          next.videoElements = partial.videoElements
          next.selectedIndex = ''
        }
        if (partial.openedFromMiningCommand !== undefined) {
          next.openedFromMiningCommand = partial.openedFromMiningCommand
        }
        return next
      }),

    setSelectedIndex: (index) => set({ selectedIndex: index }),
  }))
}
