import { createElement } from 'react'
import { VideoOverlayModel } from '@asbplayer-fork/common'
import Binding from '../services/binding'
import { OffsetAnchor } from '../services/element-overlay'
import { setExtensionEnabled } from '../services/flicktionary/extension-enabled-storage'
import { adjacentSubtitle } from '@asbplayer-fork/common/key-binder'
import { createStore } from 'zustand/vanilla'
import { mountVideoOverlayHost, type ShadowHostHandle } from '../ui/shadow/shadow-host'
import {
  ShadowVideoOverlayApp,
  type VideoOverlayCommands,
  type VideoOverlayState,
  type VideoOverlayStore,
} from '../ui/video-overlay/shadow-video-overlay-app'

const smallScreenVideoHeightThreshold = 300

// Platform players (Prime, Netflix) call pause()/play() internally around
// seeks and rebuffering, so the raw pause event fires transiently when e.g.
// navigating between subtitles. Showing the controls only after the video has
// stayed paused for this long absorbs those synthetic pause→play pairs.
const showOnPauseGraceMs = 250

// Marker for the in-realm controls overlay shadow host, so a host stranded by a
// previous content-script load / HMR is removed before remounting.
const CONTROLS_HOST_ATTR = 'data-asbplayer-video-overlay-host'

// Over-video controls overlay, rendered in the content-script realm via a
// fullscreen-aware, non-transformed Shadow DOM host (mountVideoOverlayHost). The
// model flows through a per-controller store; commands are direct Binding calls.
export class VideoOverlayController {
  private readonly _context: Binding
  private _offsetAnchor: OffsetAnchor
  private _pauseListener?: () => void
  private _playListener?: () => void
  private _seekedListener?: () => void
  private _forceHiding: boolean = false
  private _showing: boolean = false
  private _bound = false
  private _disabledMode = false
  private _showOnPauseTimeout?: ReturnType<typeof setTimeout>

  private _store?: VideoOverlayStore
  private _shadowHandle?: ShadowHostHandle

  constructor(context: Binding, offsetAnchor: OffsetAnchor) {
    this._context = context
    this._offsetAnchor = offsetAnchor
  }

  set offsetAnchor(value: OffsetAnchor) {
    if (this._offsetAnchor === value) {
      return
    }

    this._offsetAnchor = value

    // Remount the host so it re-anchors top/bottom; preserve showing state.
    if (this._shadowHandle) {
      this._unmountShadow()
      this._mountShadow()
      if (this._showing) {
        this._doShow()
      }
    }
  }

  // Global switch off: the bar renders as the single re-enable pill instead of
  // the full controls (same host, same pause/grace show logic).
  set disabledMode(value: boolean) {
    if (this._disabledMode === value) {
      return
    }

    this._disabledMode = value

    if (this._bound) {
      void this._pushModel()
    }
  }

  set forceHide(forceHide: boolean) {
    if (!this._bound) {
      return
    }

    if (forceHide) {
      if (this._showing) {
        this._doHide()
      }

      this._forceHiding = true
    } else {
      if (this._forceHiding) {
        this._forceHiding = false

        // Only re-show for a paused video: if playback resumed while
        // force-hidden, no play event is coming to hide the overlay again.
        if (this._context.video.paused) {
          this._show()
        }
      }
    }
  }

  bind() {
    if (this._bound) {
      return
    }

    this._pauseListener = () => {
      this._scheduleShow()
    }
    this._playListener = () => {
      this._cancelScheduledShow()
      this._hide()
    }
    this._seekedListener = () => {
      this.updateModel()
    }

    this._context.video.addEventListener('pause', this._pauseListener)
    this._context.video.addEventListener('play', this._playListener)
    this._context.video.addEventListener('seeked', this._seekedListener)

    this._store = createStore<VideoOverlayState>(() => ({
      model: undefined,
      visible: false,
      tooltipsEnabled: true,
      disabled: this._disabledMode,
    }))
    this._mountShadow()

    this._bound = true

    if (this._context.video.paused) {
      this._show()
    }
  }

  // Command callbacks wired straight to the Binding — each mirrors the effect the
  // matching message used to trigger via the background handlers / binding.ts
  // switch. toggleSubtitles routes through the Binding so a native caption
  // control (YouTube's CC button) is flipped video-locally when it drives
  // visibility, and the global setting is toggled otherwise.
  private _shadowCommands(): VideoOverlayCommands {
    return {
      onLoadSubtitles: () => this._context.showVideoDataDialog(false),
      onOffset: (offset: number) => this._context.subtitleController.offset(offset, false),
      onSeek: (timestampMs: number) => this._context.seek(timestampMs / 1000),
      onPlaybackRate: (playbackRate: number) => {
        this._context.video.playbackRate = playbackRate
      },
      onPlayModeSelected: (playMode) => {
        this._context.playMode = playMode
      },
      onToggleSubtitles: () => this._context.toggleSubtitles(),
      // Direct storage writes: the storage.onChanged subscription fans the
      // change out to every binding in every tab, including this one.
      onEnableExtension: () => void setExtensionEnabled(true),
      onDisableExtension: () => void setExtensionEnabled(false),
    }
  }

  private _mountShadow() {
    if (!this._store) {
      return
    }
    const store = this._store
    const anchor = this._offsetAnchor === OffsetAnchor.bottom ? 'bottom' : 'top'
    const commands = this._shadowCommands()
    this._shadowHandle = mountVideoOverlayHost({
      hostAttribute: CONTROLS_HOST_ATTR,
      video: this._context.video,
      anchor,
      offset: 8,
      // Radix/Tailwind surface: adopt the shared overlay sheet (tokens +
      // utilities) instead of emotion.
      adoptTailwind: true,
      render: ({ shadowRoot, portalContainer }) =>
        createElement(ShadowVideoOverlayApp, { store, shadowRoot, portalContainer, anchor, commands }),
    })
  }

  private _unmountShadow() {
    this._shadowHandle?.unmount()
    this._shadowHandle = undefined
  }

  // Push the latest model (and small-screen tooltips flag) into the store.
  // Visibility is re-read from `_showing` *after* the async model fetch: a
  // pause→play pair faster than the settings round-trip would otherwise
  // resurrect the overlay (a stale `visible: true` write landing after the
  // play-event hide), leaving the controls stuck on screen while playing.
  private async _pushModel() {
    if (!this._store) {
      return
    }
    const model = await this._model()
    if (!this._store) {
      return
    }
    this._store.setState({
      model,
      tooltipsEnabled: this._tooltipsEnabled(),
      visible: this._showing,
      disabled: this._disabledMode,
    })
  }

  private _tooltipsEnabled(): boolean {
    const videoRect = this._context.video.getBoundingClientRect()
    return videoRect.height >= smallScreenVideoHeightThreshold
  }

  async updateModel() {
    if (!this._bound) {
      return
    }

    await this._pushModel()
  }

  private async _model() {
    const subtitles = this._context.subtitleController.subtitles
    const subtitleDisplaying = subtitles.length > 0 && this._context.subtitleController.currentSubtitle()[0] !== null
    const timestamp = this._context.video.currentTime * 1000
    const { language, themeType } = await this._context.settings.get(['language', 'themeType'])
    const model: VideoOverlayModel = {
      offset: subtitles.length === 0 ? 0 : subtitles[0].start - subtitles[0].originalStart,
      playbackRate: this._context.video.playbackRate,
      emptySubtitleTrack: subtitles.length === 0,
      recordingEnabled: false,
      recording: false,
      previousSubtitleTimestamp: adjacentSubtitle(false, timestamp, subtitles)?.originalStart ?? undefined,
      nextSubtitleTimestamp: adjacentSubtitle(true, timestamp, subtitles)?.originalStart ?? undefined,
      currentTimestamp: timestamp,
      language,
      subtitleDisplaying,
      // Live effective visibility (global setting + any native-control
      // override) rather than the raw setting, so the icon stays truthful on
      // sites where the native CC button drives display.
      subtitlesAreVisible: this._context.subtitleController.effectiveDisplaySubtitles,
      subtitleToggleHidden: this._context.nativeCaptionsController.controllingDisplay,
      playMode: this._context.playMode,
      themeType,
    }
    return model
  }

  show() {
    if (!this._bound) {
      return
    }

    this._show()
  }

  // Clear the stale model on a subtitle reset. The host stays mounted (it's tied
  // to the video lifecycle, not the subtitle load) and is repopulated by the next
  // updateModel().
  disposeOverlay() {
    this._cancelScheduledShow()
    this._showing = false
    this._store?.setState({ model: undefined, visible: false, tooltipsEnabled: this._tooltipsEnabled() })
  }

  // Defer the show until the video has stayed paused for the grace period —
  // cancelled by the play listener — so transient platform pauses around seeks
  // don't flash the controls. If the pause belongs to an in-flight seek, keep
  // rescheduling until the seek settles or playback resumes.
  private _scheduleShow() {
    this._cancelScheduledShow()
    this._showOnPauseTimeout = setTimeout(() => {
      this._showOnPauseTimeout = undefined

      if (!this._context.video.paused) {
        return
      }

      if (this._context.video.seeking) {
        this._scheduleShow()
        return
      }

      this._show()
    }, showOnPauseGraceMs)
  }

  private _cancelScheduledShow() {
    if (this._showOnPauseTimeout !== undefined) {
      clearTimeout(this._showOnPauseTimeout)
      this._showOnPauseTimeout = undefined
    }
  }

  // No `synced` gate: the overlay must show on pause even before any subtitles
  // are loaded — it hosts the Load Subtitles button, the only way back into the
  // track dialog (the model's `emptySubtitleTrack` state covers the unsynced
  // UI). Gating on synced left the controls unreachable after cancelling the
  // track dialog.
  private _show() {
    if (this._forceHiding) {
      return
    }

    this._doShow()
  }

  private _doShow() {
    if (!this._shadowHandle) {
      this._mountShadow()
    }
    this._showing = true
    void this._pushModel()
  }

  hide() {
    if (!this._bound) {
      return
    }

    this._hide()
  }

  private _hide() {
    this._doHide()
  }

  private _doHide() {
    this._store?.setState({ visible: false })
    this._showing = false
  }

  unbind() {
    if (this._pauseListener) {
      this._context.video.removeEventListener('pause', this._pauseListener)
      this._pauseListener = undefined
    }

    if (this._playListener) {
      this._context.video.removeEventListener('play', this._playListener)
      this._playListener = undefined
    }

    if (this._seekedListener) {
      this._context.video.removeEventListener('seeked', this._seekedListener)
      this._seekedListener = undefined
    }

    this._cancelScheduledShow()
    this._unmountShadow()
    this._store = undefined
    this._showing = false
    this._bound = false
  }
}
