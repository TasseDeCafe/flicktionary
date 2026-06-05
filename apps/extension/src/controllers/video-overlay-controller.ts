import { createElement } from 'react'
import { VideoOverlayModel, VideoOverlayToVideoCommand, ToggleSubtitlesMessage } from '@asbplayer-fork/common'
import Binding from '../services/binding'
import { OffsetAnchor } from '../services/element-overlay'
import { adjacentSubtitle } from '@asbplayer-fork/common/key-binder'
import { mountVideoOverlayHost, type ShadowHostHandle } from '../ui/shadow/shadow-host'
import { createModelStore, type ModelStore } from '../ui/shadow/model-store'
import {
  ShadowVideoOverlayApp,
  type VideoOverlayCommands,
  type VideoOverlayState,
} from '../ui/video-overlay/ShadowVideoOverlayApp'

const smallScreenVideoHeightThreshold = 300

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

  private _store?: ModelStore<VideoOverlayState>
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
        this._show()
      }
    }
  }

  bind() {
    if (this._bound) {
      return
    }

    this._pauseListener = () => {
      this._show()
    }
    this._playListener = () => {
      this._hide()
    }
    this._seekedListener = () => {
      this.updateModel()
    }

    this._context.video.addEventListener('pause', this._pauseListener)
    this._context.video.addEventListener('play', this._playListener)
    this._context.video.addEventListener('seeked', this._seekedListener)

    this._store = createModelStore<VideoOverlayState>({
      model: undefined,
      visible: false,
      tooltipsEnabled: true,
    })
    this._mountShadow()

    this._bound = true

    if (this._context.video.paused) {
      this._show()
    }
  }

  // Command callbacks wired straight to the Binding — each mirrors the effect the
  // matching message used to trigger via the background handlers / binding.ts
  // switch. toggle-subtitles stays a src-only runtime message (it toggles a
  // setting and broadcasts to every video element through the background handler).
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
      onToggleSubtitles: () => {
        const command: VideoOverlayToVideoCommand<ToggleSubtitlesMessage> = {
          sender: 'asbplayer-video-overlay-to-video',
          message: { command: 'toggle-subtitles' },
          src: this._context.video.src,
        }
        browser.runtime.sendMessage(command)
      },
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

  // Push the latest model (and small-screen tooltips flag) into the store,
  // preserving the current visibility unless overridden.
  private async _pushModel(visible?: boolean) {
    if (!this._store) {
      return
    }
    const model = await this._model()
    const prev = this._store.getSnapshot()
    this._store.set({
      model,
      tooltipsEnabled: this._tooltipsEnabled(),
      visible: visible ?? prev.visible,
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
    const { language, themeType, streamingDisplaySubtitles } = await this._context.settings.get([
      'language',
      'themeType',
      'streamingDisplaySubtitles',
    ])
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
      subtitlesAreVisible: streamingDisplaySubtitles,
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
    this._store?.set({ model: undefined, visible: false, tooltipsEnabled: this._tooltipsEnabled() })
  }

  private _show() {
    if (!this._context.synced || this._forceHiding) {
      return
    }

    this._doShow()
  }

  private _doShow() {
    if (!this._shadowHandle) {
      this._mountShadow()
    }
    this._showing = true
    void this._pushModel(true)
  }

  hide() {
    if (!this._bound) {
      return
    }

    this._hide()
  }

  private _hide() {
    if (!this._context.synced) {
      return
    }

    this._doHide()
  }

  private _doHide() {
    const prev = this._store?.getSnapshot()
    if (this._store && prev) {
      this._store.set({ ...prev, visible: false })
    }
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

    this._unmountShadow()
    this._store = undefined
    this._showing = false
    this._bound = false
  }
}
