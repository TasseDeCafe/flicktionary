import { createElement } from 'react'
import {
  MobileOverlayToVideoCommand,
  MobileOverlayModel,
  UpdateMobileOverlayModelMessage,
  VideoToExtensionCommand,
  PlayModeMessage,
  ToggleSubtitlesMessage,
} from '@asbplayer-fork/common'
import Binding from '../services/binding'
import { CachingElementOverlay, OffsetAnchor } from '../services/element-overlay'
import { adjacentSubtitle } from '@asbplayer-fork/common/key-binder'
import { SHADOW_CONTROLS_OVERLAY_ENABLED } from '../services/flicktionary/shadow-ui-flags'
import { mountVideoOverlayHost, type ShadowHostHandle } from '../ui/shadow/shadow-host'
import { createModelStore, type ModelStore } from '../ui/shadow/model-store'
import {
  ShadowMobileVideoOverlayApp,
  type MobileOverlayCommands,
  type MobileOverlayState,
} from '../ui/mobile-video-overlay/ShadowMobileVideoOverlayApp'

const smallScreenVideoHeightThreshold = 300

// Marker for the in-realm controls overlay shadow host (flag-ON path), so a host
// stranded by a previous content-script load / HMR is removed before remounting.
const CONTROLS_HOST_ATTR = 'data-asbplayer-mobile-overlay-host'

interface FrameParams {
  width: number
  height: number
  anchor: 'bottom' | 'top'
  src: string
  tooltips: boolean
}

export class MobileVideoOverlayController {
  private readonly _context: Binding
  private _overlay: CachingElementOverlay
  private _pauseListener?: () => void
  private _playListener?: () => void
  private _seekedListener?: () => void
  private _forceHiding: boolean = false
  private _showing: boolean = false
  private _uiInitialized: boolean = false
  private _messageListener?: (
    message: any,
    sender: Browser.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => void
  private _bound = false
  private _frameParams?: FrameParams

  // --- Shadow DOM (flag-ON) transport ---------------------------------------
  // When SHADOW_CONTROLS_OVERLAY_ENABLED is on the controls overlay renders in
  // the content-script realm via a Shadow DOM host instead of the iframe: the
  // model flows through `_store` (replacing request/update-mobile-overlay-model)
  // and commands are wired straight to the Binding (replacing the postMessage
  // round trip). The iframe path below is untouched and stays the default.
  private readonly _useShadow = SHADOW_CONTROLS_OVERLAY_ENABLED
  private _store?: ModelStore<MobileOverlayState>
  private _shadowHandle?: ShadowHostHandle

  constructor(context: Binding, offsetAnchor: OffsetAnchor) {
    this._context = context
    this._overlay = MobileVideoOverlayController._elementOverlay(context.video, offsetAnchor)
  }

  private static _elementOverlay(video: HTMLMediaElement, offsetAnchor: OffsetAnchor) {
    const containerClassName =
      offsetAnchor === OffsetAnchor.top
        ? 'asbplayer-mobile-video-overlay-container-top'
        : 'asbplayer-mobile-video-overlay-container-bottom'
    return new CachingElementOverlay({
      targetElement: video,
      nonFullscreenContainerClassName: containerClassName,
      fullscreenContainerClassName: containerClassName,
      nonFullscreenContentClassName: 'asbplayer-mobile-video-overlay',
      fullscreenContentClassName: 'asbplayer-mobile-video-overlay',
      offsetAnchor,
      contentPositionOffset: 8,
      contentWidthPercentage: -1,
      onMouseOver: () => {},
      onMouseOut: () => {},
    })
  }

  set offsetAnchor(value: OffsetAnchor) {
    if (this._overlay.offsetAnchor === value) {
      return
    }

    this._overlay.dispose()
    this._overlay = MobileVideoOverlayController._elementOverlay(this._context.video, value)

    if (this._useShadow) {
      // Remount the host so it re-anchors top/bottom; preserve showing state.
      if (this._shadowHandle) {
        this._unmountShadow()
        this._mountShadow()
        if (this._showing) {
          this._doShow()
        }
      }
      return
    }

    if (this._showing) {
      this._doShow()
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

    if (this._useShadow) {
      this._store = createModelStore<MobileOverlayState>({
        model: undefined,
        visible: false,
        tooltipsEnabled: true,
      })
      this._mountShadow()
    } else {
      this._messageListener = (
        message: any,
        sender: Browser.runtime.MessageSender,
        sendResponse: (response?: any) => void
      ) => {
        if (message.sender !== 'asbplayer-mobile-overlay-to-video' || message.src !== this._context.video.src) {
          return
        }

        if (message.message.command === 'request-mobile-overlay-model') {
          this._model().then(sendResponse)
          this._uiInitialized = true
          return true
        }

        if (message.message.command === 'playMode') {
          const command = message as MobileOverlayToVideoCommand<PlayModeMessage>
          this._context.playMode = command.message.playMode
        } else if (message.message.command === 'hidden') {
          this._doHide()
        }
      }
      browser.runtime.onMessage.addListener(this._messageListener)
    }

    this._bound = true

    if (this._context.video.paused) {
      this._show()
    }
  }

  // The command half of the bridge as direct Binding calls (flag-ON path). Each
  // mirrors the effect the matching message used to trigger via the background
  // handlers / binding.ts switch: seek -> seek, offset -> subtitleController
  // .offset, playbackRate -> video.playbackRate, playMode -> playMode setter,
  // load-subtitles -> showVideoDataDialog. toggle-subtitles still goes through
  // the background handler (it toggles a setting and broadcasts to every video
  // element), so it stays a src-only runtime message.
  private _shadowCommands(): MobileOverlayCommands {
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
        const command: MobileOverlayToVideoCommand<ToggleSubtitlesMessage> = {
          sender: 'asbplayer-mobile-overlay-to-video',
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
    const anchor = this._overlay.offsetAnchor === OffsetAnchor.bottom ? 'bottom' : 'top'
    const commands = this._shadowCommands()
    this._shadowHandle = mountVideoOverlayHost({
      hostAttribute: CONTROLS_HOST_ATTR,
      video: this._context.video,
      anchor,
      offset: 8,
      render: ({ shadowRoot, portalContainer }) =>
        createElement(ShadowMobileVideoOverlayApp, { store, shadowRoot, portalContainer, anchor, commands }),
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

    if (this._useShadow) {
      await this._pushModel()
      return
    }

    if (!this._uiInitialized) {
      return
    }

    const model = await this._model()
    const command: VideoToExtensionCommand<UpdateMobileOverlayModelMessage> = {
      sender: 'asbplayer-video',
      message: {
        command: 'update-mobile-overlay-model',
        model,
      },
      src: this._context.video.src,
    }
    browser.runtime.sendMessage(command)
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
    const model: MobileOverlayModel = {
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

  disposeOverlay() {
    if (this._useShadow) {
      // No cached iframe DOM to drop; just clear the stale model. The host stays
      // mounted (it's tied to the video lifecycle, not the subtitle load) and is
      // repopulated by the next updateModel().
      this._store?.set({ model: undefined, visible: false, tooltipsEnabled: this._tooltipsEnabled() })
      return
    }

    this._overlay.dispose()
    this._overlay = MobileVideoOverlayController._elementOverlay(this._context.video, this._overlay.offsetAnchor)
  }

  private _show() {
    if (!this._context.synced || this._forceHiding) {
      return
    }

    this._doShow()
  }

  private _doShow() {
    if (this._useShadow) {
      if (!this._shadowHandle) {
        this._mountShadow()
      }
      this._showing = true
      void this._pushModel(true)
      return
    }

    const frameParams = this._getFrameParams()
    const { width, height, anchor, src, tooltips } = frameParams

    if (this._frameParams !== undefined && this._differentFrameParams(frameParams, this._frameParams)) {
      this._overlay.uncacheHtml()
    }

    this._overlay.setHtml([
      {
        key: 'ui',
        html: () =>
          `<iframe style="border: 0; color-scheme: normal; width: ${width}px; height: ${height}px" src="${browser.runtime.getURL(
            '/mobile-video-overlay-ui.html'
          )}?src=${src}&anchor=${anchor}&tooltips=${tooltips}"/>`,
      },
    ])

    this._frameParams = frameParams
    this._showing = true
  }

  private _getFrameParams(): FrameParams {
    const anchor = this._overlay.offsetAnchor === OffsetAnchor.bottom ? 'bottom' : 'top'
    const videoRect = this._context.video.getBoundingClientRect()
    const smallScreen = videoRect.height < smallScreenVideoHeightThreshold
    const height = smallScreen ? 64 : 108
    const tooltips = !smallScreen
    const width = Math.min(window.innerWidth, 410)
    const src = encodeURIComponent(this._context.video.src)

    return { width, height, anchor, src, tooltips }
  }

  private _differentFrameParams(a: FrameParams, b: FrameParams) {
    if (a.width !== b.width) {
      return true
    }

    if (a.height !== b.height) {
      return true
    }

    if (a.anchor !== b.anchor) {
      return true
    }

    if (a.src !== b.src) {
      return true
    }

    if (a.tooltips !== b.tooltips) {
      return true
    }

    return false
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
    if (this._useShadow) {
      const prev = this._store?.getSnapshot()
      if (this._store && prev) {
        this._store.set({ ...prev, visible: false })
      }
      this._showing = false
      return
    }

    this._overlay.hide()
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

    if (this._messageListener) {
      browser.runtime.onMessage.removeListener(this._messageListener)
      this._messageListener = undefined
    }

    if (this._useShadow) {
      this._unmountShadow()
      this._store = undefined
    } else {
      this._overlay.dispose()
      this._overlay = MobileVideoOverlayController._elementOverlay(this._context.video, this._overlay.offsetAnchor)
    }

    this._showing = false
    this._bound = false
  }
}
