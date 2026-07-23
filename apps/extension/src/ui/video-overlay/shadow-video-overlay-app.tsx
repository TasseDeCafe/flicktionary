import type { ControlType, VideoOverlayModel, PlayMode } from '@asbplayer-fork/common'
import VideoOverlay from '@asbplayer-fork/common/components/VideoOverlay'
import VideoOverlayDisabled from '@asbplayer-fork/common/components/VideoOverlayDisabled'
import CheckpointFeedbackChip, {
  type CheckpointFeedback,
} from '@asbplayer-fork/common/components/CheckpointFeedbackChip'
import useLastScrollableControlType from '@asbplayer-fork/common/hooks/use-last-scrollable-control-type'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { ShadowUiProvider } from '../shadow/shadow-ui-provider'
import { DeclarationSheet, type CollectOutcome, type SweepOutcome } from './declaration-sheet'
import type { DeclarationState } from './declaration-preview'

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
  // Checkpoint info/error feedback. Rendered OUTSIDE the `visible` gate: the
  // controls hide on play, the chip must not — its ~8s lifetime belongs to
  // the controller.
  checkpointFeedback: CheckpointFeedback | null
  // The declaration (checkpoint + mark-known) sheet's run state; null =
  // closed. Also outside the `visible` gate — the flow survives play/pause.
  declaration: DeclarationState | null
  // Markable-word count at the paused position (read-only probe) — the web
  // pill's ambient sweep count. Null = unknown/none: the checkpoint button
  // falls back to its bookmark face.
  markKnownBadge: number | null
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
  onDisableExtension: () => void
  onCheckpoint: () => void
  onDeclarationCollect: () => Promise<CollectOutcome>
  onDeclarationRefreshSnapshot: () => void
  onDeclarationSweep: () => Promise<SweepOutcome>
  onDeclarationUndoSweep: (sweepBatchId: string) => Promise<boolean>
  onDeclarationUndoCheckpoint: (checkpointId: string) => Promise<{ ok: boolean; undone: boolean }>
  onDeclarationClose: () => void
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
  const { model, visible, tooltipsEnabled, disabled, checkpointFeedback, declaration, markKnownBadge } = useStore(store)
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
            onDisableExtension={commands.onDisableExtension}
            onCheckpoint={commands.onCheckpoint}
            markKnownCount={markKnownBadge}
          />
        </div>
      )}
      {/* Deliberately NOT behind `visible`: pressing play hides the controls
          bar, but the feedback chip must survive the resume. */}
      {!disabled && checkpointFeedback && (
        <div style={{ pointerEvents: 'auto' }} className='mt-2 flex justify-center'>
          <CheckpointFeedbackChip feedback={checkpointFeedback} />
        </div>
      )}
      {/* Also outside `visible`: the declaration flow spans play/pause and
          owns its own dismissal. */}
      {!disabled && declaration && (
        <DeclarationSheet
          key={declaration.runKey}
          declaration={declaration}
          onCollect={commands.onDeclarationCollect}
          onRefreshSnapshot={commands.onDeclarationRefreshSnapshot}
          onSweep={commands.onDeclarationSweep}
          onUndoSweep={commands.onDeclarationUndoSweep}
          onUndoCheckpoint={commands.onDeclarationUndoCheckpoint}
          onClose={commands.onDeclarationClose}
        />
      )}
    </ShadowUiProvider>
  )
}
