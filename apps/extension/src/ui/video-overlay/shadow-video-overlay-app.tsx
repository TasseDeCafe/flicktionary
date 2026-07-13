import type { ControlType, VideoOverlayModel, PlayMode } from '@asbplayer-fork/common'
import VideoOverlay from '@asbplayer-fork/common/components/VideoOverlay'
import VideoOverlayDisabled from '@asbplayer-fork/common/components/VideoOverlayDisabled'
import useLastScrollableControlType from '@asbplayer-fork/common/hooks/use-last-scrollable-control-type'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { ShadowUiProvider } from '../shadow/shadow-ui-provider'

// The in-realm replacement for the iframe model transport. The controller pushes
// snapshots into the zustand store (formerly the request/update-video-overlay-model
// round trip); `visible` flips on pause/play (formerly mount/unmount of the
// iframe); `tooltipsEnabled` is the small-screen flag the controller used to
// bake into the iframe URL. Per-controller store, never a module singleton.
export interface VideoOverlayState {
  model: VideoOverlayModel | undefined
  visible: boolean
  tooltipsEnabled: boolean
  // Global extension switch off: render the minimal re-enable pill instead of
  // the full controls bar.
  disabled: boolean
}

export type VideoOverlayStore = StoreApi<VideoOverlayState>

// The command half of the bridge, now plain callbacks the controller wires
// straight to the Binding (no postMessage round trip).
export interface VideoOverlayCommands {
  onLoadSubtitles: () => void
  onOffset: (offset: number) => void
  onSeek: (timestampMs: number) => void
  onPlaybackRate: (playbackRate: number) => void
  onPlayModeSelected: (playMode: PlayMode) => void
  onToggleSubtitles: () => void
  onEnableExtension: () => void
}

export interface ShadowVideoOverlayAppProps {
  store: VideoOverlayStore
  shadowRoot: ShadowRoot
  portalContainer: HTMLElement
  anchor: 'top' | 'bottom'
  commands: VideoOverlayCommands
}

// `initialControlType` / `onScrollToControlType` persist the user's last-used
// scrollable control across renders via extension storage.
const lastControlTypeKey = 'lastScrollableControlType'

const fetchLastControlType = async (): Promise<ControlType | undefined> => {
  const result = await browser.storage.local.get(lastControlTypeKey)
  return result ? (result[lastControlTypeKey] as ControlType | undefined) : undefined
}

const saveLastControlType = async (controlType: ControlType): Promise<void> => {
  await browser.storage.local.set({ [lastControlTypeKey]: controlType })
}

export function ShadowVideoOverlayApp({ store, portalContainer, anchor, commands }: ShadowVideoOverlayAppProps) {
  const { model, visible, tooltipsEnabled, disabled } = useStore(store)
  const { lastControlType, setLastControlType } = useLastScrollableControlType({
    saveLastControlType,
    fetchLastControlType,
  })

  return (
    <ShadowUiProvider
      portalContainer={portalContainer}
      themeType={model?.themeType ?? 'system'}
      language={model?.language ?? 'system'}
    >
      {/* Disabled pill: not gated on model/lastControlType — the model is
          disposed while the extension is off, and the pill needs neither. */}
      {visible && disabled && (
        <div style={{ pointerEvents: 'auto' }}>
          <VideoOverlayDisabled
            anchor={anchor}
            tooltipsEnabled={tooltipsEnabled}
            onEnable={commands.onEnableExtension}
          />
        </div>
      )}
      {visible && !disabled && lastControlType !== undefined && model !== undefined && (
        // The host + appRoot are click-through (pointer-events:none) so the empty
        // area around the bar doesn't steal clicks from the player. Re-enable
        // pointer events on the bar itself, else clicks pass through to the video
        // (toggling play, which hides the overlay).
        <div style={{ pointerEvents: 'auto' }}>
          <VideoOverlay
            model={model}
            anchor={anchor}
            tooltipsEnabled={tooltipsEnabled}
            initialControlType={lastControlType}
            onScrollToControlType={setLastControlType}
            onLoadSubtitles={commands.onLoadSubtitles}
            onOffset={commands.onOffset}
            onSeek={commands.onSeek}
            onPlaybackRate={commands.onPlaybackRate}
            onPlayModeSelected={commands.onPlayModeSelected}
            onToggleSubtitles={commands.onToggleSubtitles}
          />
        </div>
      )}
    </ShadowUiProvider>
  )
}
