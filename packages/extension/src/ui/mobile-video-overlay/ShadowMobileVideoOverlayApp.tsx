import type { ControlType, MobileOverlayModel, PlayMode } from '@asbplayer-fork/common'
import type { PaletteMode } from '@mui/material/styles'
import MobileVideoOverlay from '@asbplayer-fork/common/components/MobileVideoOverlay'
import useLastScrollableControlType from '@asbplayer-fork/common/hooks/use-last-scrollable-control-type'
import { ShadowMuiProvider } from '../shadow/ShadowMuiProvider'
import { ModelStore, useModelStore } from '../shadow/model-store'

// The in-realm replacement for the iframe model transport. The controller pushes
// snapshots into the store (formerly the request/update-mobile-overlay-model
// round trip); `visible` flips on pause/play (formerly mount/unmount of the
// iframe); `tooltipsEnabled` is the small-screen flag the controller used to
// bake into the iframe URL.
export interface MobileOverlayState {
  model: MobileOverlayModel | undefined
  visible: boolean
  tooltipsEnabled: boolean
}

// The command half of the bridge, now plain callbacks the controller wires
// straight to the Binding (no postMessage round trip).
export interface MobileOverlayCommands {
  onLoadSubtitles: () => void
  onOffset: (offset: number) => void
  onSeek: (timestampMs: number) => void
  onPlaybackRate: (playbackRate: number) => void
  onPlayModeSelected: (playMode: PlayMode) => void
  onToggleSubtitles: () => void
}

export interface ShadowMobileVideoOverlayAppProps {
  store: ModelStore<MobileOverlayState>
  shadowRoot: ShadowRoot
  portalContainer: HTMLElement
  anchor: 'top' | 'bottom'
  commands: MobileOverlayCommands
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

export function ShadowMobileVideoOverlayApp({
  store,
  shadowRoot,
  portalContainer,
  anchor,
  commands,
}: ShadowMobileVideoOverlayAppProps) {
  const { model, visible, tooltipsEnabled } = useModelStore(store)
  const { lastControlType, setLastControlType } = useLastScrollableControlType({
    saveLastControlType,
    fetchLastControlType,
  })

  return (
    <ShadowMuiProvider
      shadowRoot={shadowRoot}
      portalContainer={portalContainer}
      themeType={(model?.themeType as PaletteMode) ?? 'dark'}
      language={model?.language ?? 'en'}
    >
      {visible && lastControlType !== undefined && model !== undefined && (
        // The host + appRoot are click-through (pointer-events:none) so the empty
        // area around the bar doesn't steal clicks from the player. Re-enable
        // pointer events on the bar itself, else clicks pass through to the video
        // (toggling play, which hides the overlay).
        <div style={{ pointerEvents: 'auto' }}>
          <MobileVideoOverlay
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
    </ShadowMuiProvider>
  )
}
