import {
  AckMessage,
  ExtensionToVideoCommand,
  Message,
  MessageWithId,
  AutoPausePreference,
  cropAndResize,
  CurrentTimeFromVideoMessage,
  CurrentTimeToVideoMessage,
  ExtensionSyncMessage,
  NotificationDialogMessage,
  NotifyErrorMessage,
  OffsetToVideoMessage,
  PauseFromVideoMessage,
  PlaybackRateFromVideoMessage,
  PlaybackRateToVideoMessage,
  PlayFromVideoMessage,
  PlayMode,
  ReadyFromVideoMessage,
  ReadyStateFromVideoMessage,
  RequestingActiveTabPermsisionMessage,
  SubtitleModel,
  SubtitlesToVideoMessage,
  VideoDataUiOpenReason,
  VideoDisappearedMessage,
  VideoHeartbeatMessage,
  VideoToExtensionCommand,
  IndexedSubtitleModel,
  SaveWordFlicktionaryVideoContext,
  ToggleSubtitlesMessage,
} from '@asbplayer-fork/common'
type FlicktionaryVideoContext = SaveWordFlicktionaryVideoContext
import {
  computeSubtitlesContentHash,
  getCurrentYoutubeMetadata,
  isYoutubeWatchPage,
  normalizeYoutubeLanguageCode,
  toFlicktionarySegments,
} from './flicktionary/youtube-context'
import { getCurrentStreamingMetadata, pickStreamingTitle } from './flicktionary/page-context'
import { PauseOnHoverMode, SettingsProvider, SubtitleListPreference } from '@asbplayer-fork/common/settings'
import { SubtitleSlice } from '@asbplayer-fork/common/subtitle-collection'
import { SubtitleReader } from '@asbplayer-fork/common/subtitle-reader'
import { seekWithNudge } from '@asbplayer-fork/common/util'
import ControlsController from '../controllers/controls-controller'
import DragController from '../controllers/drag-controller'
import { VideoOverlayController } from '../controllers/video-overlay-controller'
import NativeCaptionsController from '../controllers/native-captions-controller'
import NotificationController from '../controllers/notification-controller'
import SubtitleController from '../controllers/subtitle-controller'
import VideoDataSyncController from '../controllers/video-data-sync-controller'
import { OffsetAnchor } from './element-overlay'
import { FlicktionaryVideoClosures } from './flicktionary/flicktionary-client'
import { ExtensionSettingsStorage } from './extension-settings-storage'
import { setupLingui } from '../ui/lingui'
import KeyBindings from './key-bindings'
import { shouldShowUpdateAlert } from './update-alert'
import { bufferToBase64 } from '@asbplayer-fork/common/base64'

let netflix = false
document.addEventListener('asbplayer-netflix-enabled', (e) => {
  netflix = (e as CustomEvent).detail
})
document.dispatchEvent(new CustomEvent('asbplayer-query-netflix'))

const youtube = /(m|www)\.youtube\.com/.test(window.location.host)

export default class Binding {
  subscribed: boolean = false

  alwaysPlayOnSubtitleRepeat: boolean

  private _synced: boolean
  private _syncedTimestamp?: number

  private pausedDueToHover = false
  private _playMode: PlayMode = PlayMode.normal
  private _seekDuration = 3
  private _speedChangeStep = 0.1

  readonly video: HTMLMediaElement
  readonly hasPageScript: boolean
  readonly subtitleController: SubtitleController
  readonly videoDataSyncController: VideoDataSyncController
  readonly controlsController: ControlsController
  readonly dragController: DragController
  readonly notificationController: NotificationController
  readonly videoOverlayController: VideoOverlayController
  readonly nativeCaptionsController: NativeCaptionsController
  readonly keyBindings: KeyBindings
  readonly settings: SettingsProvider

  // Snapshot of the current YouTube video + parsed subtitles, populated by
  // `_prepareFlicktionaryVideoContext`. The React subtitle overlay reads
  // this through a closure so SaveWordMessage can carry a self-contained
  // payload — the first save creates the backend session from it.
  private _flicktionaryVideoContext: FlicktionaryVideoContext | undefined

  // BCP-47 language code of the YouTube caption track the user selected, set
  // by the video-data-sync flow before subtitles load. A hint only: the overlay
  // uses it as the tokenizer/gloss language until the first save delivers the
  // server-detected language, and to name the language in the "unsupported"
  // notice. The backend always detects the real language from the text.
  private _flicktionarySubtitleLanguageHint: string | undefined

  // When set, saving is disabled for the current video (its subtitles are in
  // an unsupported language) and the React overlay surfaces this reason
  // instead of attempting a save.
  private _flicktionarySaveDisabledReason: string | undefined

  private maxImageWidth: number
  private maxImageHeight: number
  private autoPausePreference: AutoPausePreference
  private condensedPlaybackMinimumSkipIntervalMs = 1000
  private fastForwardPlaybackMinimumGapMs = 600
  private fastForwardModePlaybackRate = 2.7
  private pauseOnHoverMode: PauseOnHoverMode = PauseOnHoverMode.disabled

  private playListener?: EventListener
  private pauseListener?: EventListener
  private seekedListener?: EventListener
  private playbackRateListener?: EventListener
  private videoChangeListener?: EventListener
  private canPlayListener?: EventListener
  private mouseMoveListener?: (event: MouseEvent) => void
  private listener?: (
    message: ExtensionToVideoCommand<Message>,
    sender: Browser.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => void
  private heartbeatInterval?: NodeJS.Timeout

  private readonly frameId?: string

  constructor(video: HTMLMediaElement, hasPageScript: boolean, frameId?: string) {
    this.video = video
    this.hasPageScript = hasPageScript
    this.settings = new SettingsProvider(new ExtensionSettingsStorage())
    this.subtitleController = new SubtitleController(video, this.settings)
    this.videoDataSyncController = new VideoDataSyncController(this, this.settings)
    this.controlsController = new ControlsController(video)
    this.dragController = new DragController(video)
    this.keyBindings = new KeyBindings()
    this.notificationController = new NotificationController(this)
    this.videoOverlayController = new VideoOverlayController(this, OffsetAnchor.top)
    this.nativeCaptionsController = new NativeCaptionsController(this)
    this.subtitleController.onOffsetChange = () => this.videoOverlayController.updateModel()
    this.maxImageWidth = 0
    this.maxImageHeight = 0
    this.autoPausePreference = AutoPausePreference.atEnd
    this.alwaysPlayOnSubtitleRepeat = true
    this._synced = false
    this.frameId = frameId
  }

  get synced() {
    return this._synced
  }

  get speedChangeStep() {
    return this._speedChangeStep
  }

  get seekDuration() {
    return this._seekDuration
  }

  get playMode() {
    return this._playMode
  }

  set playMode(newPlayMode: PlayMode) {
    if (this._playMode === newPlayMode) {
      return
    }

    // Disable old play mode
    switch (this._playMode) {
      case PlayMode.autoPause:
        this.subtitleController.autoPauseContext.onStartedShowing = undefined
        this.subtitleController.autoPauseContext.onWillStopShowing = undefined
        break
      case PlayMode.condensed:
        this.subtitleController.onNextToShow = undefined
        break
      case PlayMode.fastForward:
        this.subtitleController.onSlice = undefined
        this.video.playbackRate = 1
        break
      case PlayMode.repeat:
        this.subtitleController.autoPauseContext.onWillStopShowing = undefined
        break
    }

    let changed = false

    // Enable new play mode
    switch (newPlayMode) {
      case PlayMode.autoPause:
        this.subtitleController.autoPauseContext.onStartedShowing = () => {
          if (this.autoPausePreference !== AutoPausePreference.atStart) {
            return
          }

          this.pause()
        }
        this.subtitleController.autoPauseContext.onWillStopShowing = () => {
          if (this.autoPausePreference !== AutoPausePreference.atEnd) {
            return
          }

          this.pause()
        }
        this.subtitleController.notification('info.enabledAutoPause')
        changed = true
        break
      case PlayMode.condensed:
        let seeking = false
        this.subtitleController.onNextToShow = async (subtitle) => {
          try {
            if (
              seeking ||
              this.video.paused ||
              subtitle.start - this.video.currentTime * 1000 <= this.condensedPlaybackMinimumSkipIntervalMs
            ) {
              return
            }

            seeking = true
            this.seek(subtitle.start / 1000)
            await this.play()
            seeking = false
          } finally {
            seeking = false
          }
        }
        this.subtitleController.notification('info.enabledCondensedPlayback')
        changed = true
        break
      case PlayMode.fastForward:
        this.subtitleController.onSlice = async (slice: SubtitleSlice<IndexedSubtitleModel>) => {
          const subtitlesAreSufficientlyOffsetFromNow = (subtitleEdgeTime: number | undefined) => {
            return (
              subtitleEdgeTime &&
              Math.abs(subtitleEdgeTime - this.video.currentTime * 1000) > this.fastForwardPlaybackMinimumGapMs
            )
          }
          if (
            slice.showing.length === 0 &&
            // Find latest ending subtitle among the shown last ones
            subtitlesAreSufficientlyOffsetFromNow(
              Math.max.apply(
                undefined,
                (slice?.lastShown || []).map((e) => e.end)
              )
            ) &&
            // Find earliest starting subtitle among the next ones to be shown
            subtitlesAreSufficientlyOffsetFromNow(
              Math.min.apply(
                undefined,
                (slice?.nextToShow || []).map((e) => e.start)
              )
            )
          ) {
            this.video.playbackRate = this.fastForwardModePlaybackRate
          } else {
            this.video.playbackRate = 1
          }
        }
        this.subtitleController.notification('info.enabledFastForwardPlayback')
        changed = true
        break
      case PlayMode.repeat:
        const [currentSubtitle] = this.subtitleController.currentSubtitle()
        if (currentSubtitle) {
          this.subtitleController.autoPauseContext.onWillStopShowing = () => {
            this.seek(currentSubtitle.start / 1000)
          }
          this.subtitleController.notification('info.enabledRepeatPlayback')
          changed = true
        }
        break
      case PlayMode.normal:
        if (this._playMode === PlayMode.repeat) {
          this.subtitleController.notification('info.disabledRepeatPlayback')
        } else if (this._playMode === PlayMode.autoPause) {
          this.subtitleController.notification('info.disabledAutoPause')
        } else if (this._playMode === PlayMode.condensed) {
          this.subtitleController.notification('info.disabledCondensedPlayback')
        } else if (this._playMode === PlayMode.fastForward) {
          this.subtitleController.notification('info.disabledFastForwardPlayback')
        }
        changed = true
        break
      default:
        console.error('Unknown play mode ' + newPlayMode)
    }

    if (changed) {
      this._playMode = newPlayMode
      this.videoOverlayController.updateModel()
    }
  }

  subtitleFileName(track: number = 0) {
    return this.subtitleController.subtitleFileNames?.[track] ?? ''
  }

  private get _shouldAutoResumeOnSubtitlesMouseOut() {
    return this.pauseOnHoverMode === PauseOnHoverMode.inAndOut && this.pausedDueToHover && this.video.paused
  }

  bind() {
    let bound = false

    if (this.video.readyState === 4) {
      this._bind()
      bound = true
    } else {
      this.canPlayListener = (event) => {
        if (!bound) {
          this._bind()
          bound = true
        }

        const command: VideoToExtensionCommand<ReadyStateFromVideoMessage> = {
          sender: 'asbplayer-video',
          message: {
            command: 'readyState',
            value: 4,
          },
          src: this.video.src,
        }

        browser.runtime.sendMessage(command)
      }
      this.video.addEventListener('canplay', this.canPlayListener)
    }
  }

  _bind() {
    this._notifyReady()
    this._subscribe()
    this._refreshSettings().then(() => {
      this.videoDataSyncController.requestSubtitles()
    })
    this.subtitleController.bind()
    this.dragController.bind(this)
  }

  _notifyReady() {
    const command: VideoToExtensionCommand<ReadyFromVideoMessage> = {
      sender: 'asbplayer-video',
      message: {
        command: 'ready',
        duration: this.video.duration,
        currentTime: this.video.currentTime,
        paused: this.video.paused,
        audioTracks: undefined,
        selectedAudioTrack: undefined,
        playbackRate: this.video.playbackRate,
      },
      src: this.video.src,
    }

    browser.runtime.sendMessage(command)
  }

  _subscribe() {
    this.playListener = (event) => {
      const command: VideoToExtensionCommand<PlayFromVideoMessage> = {
        sender: 'asbplayer-video',
        message: {
          command: 'play',
          echo: false,
        },
        src: this.video.src,
      }

      browser.runtime.sendMessage(command)
      this.pausedDueToHover = false
    }

    this.pauseListener = (event) => {
      const command: VideoToExtensionCommand<PauseFromVideoMessage> = {
        sender: 'asbplayer-video',
        message: {
          command: 'pause',
          echo: false,
        },
        src: this.video.src,
      }

      browser.runtime.sendMessage(command)
    }

    this.seekedListener = (event) => {
      const currentTimeCommand: VideoToExtensionCommand<CurrentTimeFromVideoMessage> = {
        sender: 'asbplayer-video',
        message: {
          command: 'currentTime',
          value: this.video.currentTime,
          echo: false,
        },
        src: this.video.src,
      }
      const readyStateCommand: VideoToExtensionCommand<ReadyStateFromVideoMessage> = {
        sender: 'asbplayer-video',
        message: {
          command: 'readyState',
          value: this.video.readyState,
        },
        src: this.video.src,
      }

      browser.runtime.sendMessage(currentTimeCommand)
      browser.runtime.sendMessage(readyStateCommand)

      this.subtitleController.autoPauseContext.clear()
    }

    this.playbackRateListener = (event) => {
      const command: VideoToExtensionCommand<PlaybackRateFromVideoMessage> = {
        sender: 'asbplayer-video',
        message: {
          command: 'playbackRate',
          value: this.video.playbackRate,
          echo: false,
        },
        src: this.video.src,
      }

      browser.runtime.sendMessage(command)

      if (this._synced && this._playMode !== PlayMode.fastForward) {
        this.subtitleController.notification('info.playbackRate', {
          rate: this.video.playbackRate.toFixed(1),
        })
      }
      this.videoOverlayController.updateModel()
    }

    this.video.addEventListener('play', this.playListener)
    this.video.addEventListener('pause', this.pauseListener)
    this.video.addEventListener('seeked', this.seekedListener)
    this.video.addEventListener('ratechange', this.playbackRateListener)

    this.subtitleController.onMouseOver = (mouseEvent: MouseEvent) => {
      if (this.pauseOnHoverMode !== PauseOnHoverMode.disabled && !this.video.paused) {
        this.video.pause()
        this.pausedDueToHover = true

        if (this.mouseMoveListener) {
          document.removeEventListener('mousemove', this.mouseMoveListener)
          this.mouseMoveListener = undefined
        }

        this.mouseMoveListener = (e: MouseEvent) => {
          if (this._shouldAutoResumeOnSubtitlesMouseOut && !this.subtitleController.intersects(e.clientX, e.clientY)) {
            this.play()
            this.pausedDueToHover = false
          }
        }

        document.addEventListener('mousemove', this.mouseMoveListener)
      }
    }

    if (this.hasPageScript) {
      this.videoChangeListener = () => {
        this.videoDataSyncController.requestSubtitles()
        this._resetSubtitles()
      }
      this.video.addEventListener('loadedmetadata', this.videoChangeListener)
    }

    this.heartbeatInterval = setInterval(() => {
      const command: VideoToExtensionCommand<VideoHeartbeatMessage> = {
        sender: 'asbplayer-video',
        message: {
          command: 'heartbeat',
          subscribed: this.subscribed,
          synced: this._synced,
          syncedTimestamp: this._syncedTimestamp,
          loadedSubtitles: this.subtitleController.subtitles.length > 0,
        },
        src: this.video.src,
      }

      browser.runtime.sendMessage(command)
    }, 1000)

    window.addEventListener('beforeunload', (event) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval)
      }
    })

    this.listener = (
      request: ExtensionToVideoCommand<Message>,
      sender: Browser.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => {
      if (request.sender === 'asbplayer-extension-to-video' && request.src === this.video.src) {
        switch (request.message.command) {
          case 'init':
            this._notifyReady()
            break
          case 'ready':
            // ignore
            break
          case 'play':
            this.play()
            break
          case 'pause':
            this.pause()
            break
          case 'currentTime':
            const currentTimeMessage = request.message as CurrentTimeToVideoMessage
            this.seek(currentTimeMessage.value)
            break
          case 'close':
            // ignore
            break
          case 'subtitles': {
            const subtitlesMessage = request.message as SubtitlesToVideoMessage
            const subtitles: SubtitleModel[] = subtitlesMessage.value
            this._updateSubtitles(
              subtitles.map((s, index) => ({ ...s, index })),
              subtitlesMessage.names || [subtitlesMessage.name]
            )
            break
          }
          case 'request-subtitles': {
            sendResponse({
              subtitles: this.subtitleController.subtitles,
              subtitleFileNames: this.subtitleController.subtitleFileNames ?? [],
            })
            break
          }
          // This is useful because when we kick off bulk export the side panel needs to know
          // what subtitle to start from.
          case 'request-current-subtitle':
            const [currentSubtitle] = this.subtitleController.currentSubtitle()
            sendResponse({
              currentSubtitle: currentSubtitle,
              currentSubtitleIndex: currentSubtitle?.index ?? null,
            })
            break
          case 'offset':
            const offsetMessage = request.message as OffsetToVideoMessage
            this.subtitleController.offset(offsetMessage.value, !offsetMessage.echo)
            break
          case 'playbackRate':
            const playbackRateMessage = request.message as PlaybackRateToVideoMessage
            this.video.playbackRate = playbackRateMessage.value
            break
          case 'subtitleSettings':
            // ignore
            break
          case 'miscSettings':
            // ignore
            break
          case 'settings-updated':
            this._refreshSettings()
            break
          case 'notify-error':
            const notifyErrorMessage = request.message as NotifyErrorMessage
            this.subtitleController.notification('info.error', { message: notifyErrorMessage.message })
            break
          case 'alert':
            // ignore
            break
          case 'request-active-tab-permission':
            this.notificationController.onClose = () => {
              this._notifyRequestingActiveTabPermission(false)
            }
            this.notificationController.show('activeTabPermissionRequest.title', 'activeTabPermissionRequest.prompt')
            this._notifyRequestingActiveTabPermission(true)
            break
          case 'granted-active-tab-permission':
            if (this.notificationController.showing) {
              this.notificationController.show(
                'activeTabPermissionRequest.grantedTitle',
                'activeTabPermissionRequest.grantedPrompt'
              )
            }
            break
          case 'load-subtitles':
            this.showVideoDataDialog(false)
            break
          case 'notification-dialog':
            const notificationDialogMessage = request.message as NotificationDialogMessage
            this.notificationController.show(
              notificationDialogMessage.titleLocKey,
              notificationDialogMessage.messageLocKey
            )
            break
        }

        if ('messageId' in request.message) {
          const ackCommand: VideoToExtensionCommand<AckMessage> = {
            sender: 'asbplayer-video',
            message: {
              command: 'ack-message',
              messageId: (request.message as MessageWithId).messageId,
            },
            src: this.video.src,
          }
          browser.runtime.sendMessage(ackCommand)
        }
      }
    }

    browser.runtime.onMessage.addListener(this.listener)
    this.subscribed = true
  }

  // The per-video closures the React overlay (and the legacy controller) use to
  // build a self-contained SaveWordMessage. Stable getters reading live state.
  private _flicktionaryClosures(): FlicktionaryVideoClosures {
    return {
      getVideoTitle: () => document.title,
      getVideoUrl: () => window.location.href,
      getFlicktionaryVideoContext: () => this._flicktionaryVideoContext,
      getFlicktionarySaveDisabledReason: () => this._flicktionarySaveDisabledReason,
      // The overlay learns "this video's language is unsupported" from a save
      // attempt (sessions are created lazily on first save) and parks the
      // reason here so subsequent gloss tooltips render saving as disabled.
      setFlicktionarySaveDisabledReason: (reason: string) => {
        this._flicktionarySaveDisabledReason = reason
      },
      getFlicktionarySubtitleLanguageHint: () => this._flicktionarySubtitleLanguageHint,
    }
  }

  async _refreshSettings() {
    const currentSettings = await this.settings.getAll()
    this._seekDuration = currentSettings.seekDuration
    this._speedChangeStep = currentSettings.speedChangeStep
    this.condensedPlaybackMinimumSkipIntervalMs = currentSettings.streamingCondensedPlaybackMinimumSkipIntervalMs
    this.fastForwardModePlaybackRate = currentSettings.fastForwardModePlaybackRate
    this.maxImageWidth = currentSettings.maxImageWidth
    this.maxImageHeight = currentSettings.maxImageHeight
    this.autoPausePreference = currentSettings.autoPausePreference
    this.alwaysPlayOnSubtitleRepeat = currentSettings.alwaysPlayOnSubtitleRepeat
    this.pauseOnHoverMode = currentSettings.pauseOnHoverMode

    this.subtitleController.displaySubtitles = currentSettings.streamingDisplaySubtitles
    this.subtitleController.bottomSubtitlePositionOffset = currentSettings.subtitlePositionOffset
    this.subtitleController.topSubtitlePositionOffset = currentSettings.topSubtitlePositionOffset
    this.subtitleController.subtitlesWidth = currentSettings.subtitlesWidth
    this.subtitleController.surroundingSubtitlesCountRadius = currentSettings.surroundingSubtitlesCountRadius
    this.subtitleController.surroundingSubtitlesTimeRadius = currentSettings.surroundingSubtitlesTimeRadius
    this.subtitleController.autoCopyCurrentSubtitle = currentSettings.autoCopyCurrentSubtitle
    this.subtitleController.toasterTheme = currentSettings.themeType

    this.subtitleController.setSubtitleSettings(currentSettings)

    // Keep the React overlay hosts in sync now that alignment is current.
    this.subtitleController.ensureReactOverlays(this._flicktionaryClosures())

    this.subtitleController.refresh()

    this.videoDataSyncController.updateSettings(currentSettings)
    this.keyBindings.setKeyBindSet(this, currentSettings.keyBindSet)

    if (currentSettings.streamingSubsDragAndDrop) {
      this.dragController.bind(this)
    } else {
      this.dragController.unbind()
    }

    if (currentSettings.streamingEnableOverlay) {
      this.videoOverlayController.offsetAnchor =
        currentSettings.subtitleAlignment === 'bottom' ? OffsetAnchor.top : OffsetAnchor.bottom
      this.videoOverlayController.bind()
      this.videoOverlayController.updateModel()
    } else {
      this.videoOverlayController.unbind()
    }

    setupLingui(currentSettings.language)
  }

  unbind() {
    if (this.canPlayListener) {
      this.video.removeEventListener('canplay', this.canPlayListener)
      this.canPlayListener = undefined
    }

    if (this.playListener) {
      this.video.removeEventListener('play', this.playListener)
      this.playListener = undefined
    }

    if (this.pauseListener) {
      this.video.removeEventListener('pause', this.pauseListener)
      this.pauseListener = undefined
    }

    if (this.seekedListener) {
      this.video.removeEventListener('seeked', this.seekedListener)
      this.seekedListener = undefined
    }

    if (this.playbackRateListener) {
      this.video.removeEventListener('ratechange', this.playbackRateListener)
      this.playbackRateListener = undefined
    }

    if (this.videoChangeListener) {
      this.video.removeEventListener('loadedmetadata', this.videoChangeListener)
      this.videoChangeListener = undefined
    }

    if (this.mouseMoveListener) {
      document.removeEventListener('mousemove', this.mouseMoveListener)
      this.mouseMoveListener = undefined
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }

    if (this.listener) {
      browser.runtime.onMessage.removeListener(this.listener)
      this.listener = undefined
    }

    this.subtitleController.unbind()
    this.dragController.unbind()
    this.keyBindings.unbind()
    this.videoDataSyncController.unbind()
    this.videoOverlayController.unbind()
    this.nativeCaptionsController.unbind()
    this.notificationController.unbind()
    this.subscribed = false

    const command: VideoToExtensionCommand<VideoDisappearedMessage> = {
      sender: 'asbplayer-video',
      message: {
        command: 'video-disappeared',
      },
      src: this.video.src,
    }
    browser.runtime.sendMessage(command)
  }

  seek(timestamp: number) {
    if (netflix) {
      document.dispatchEvent(
        new CustomEvent('asbplayer-netflix-seek', {
          detail: timestamp * 1000,
        })
      )
    } else {
      seekWithNudge(this.video, timestamp)
    }
  }

  async play() {
    if (netflix) {
      await this._playNetflix()
      return
    }

    try {
      await this.video.play()
    } catch (ex) {
      // Ignore exception

      if (this.video.readyState !== 4) {
        // Deal with Amazon Prime player pausing in the middle of play, without loss of generality
        return new Promise((resolve, reject) => {
          const listener = async (evt: Event) => {
            let retries = 3

            for (let i = 0; i < retries; ++i) {
              try {
                await this.video.play()
                break
              } catch (ex2) {
                console.error(ex2)
              }
            }

            resolve(undefined)
            this.video.removeEventListener('canplay', listener)
          }

          this.video.addEventListener('canplay', listener)
        })
      }
    }
  }

  _playNetflix() {
    return new Promise((resolve, reject) => {
      const listener = async (evt: Event) => {
        this.video.removeEventListener('play', listener)
        this.video.removeEventListener('playing', listener)
        resolve(undefined)
      }

      this.video.addEventListener('play', listener)
      this.video.addEventListener('playing', listener)
      document.dispatchEvent(new CustomEvent('asbplayer-netflix-play'))
    })
  }

  pause() {
    if (netflix) {
      document.dispatchEvent(new CustomEvent('asbplayer-netflix-pause'))
      return
    }

    this.video.pause()
  }

  // Single entry point for the user-facing subtitle toggle (overlay button +
  // keyboard shortcut). While a native caption control drives visibility, the
  // toggle flips it video-locally; otherwise it flips the persisted global
  // setting through the background handler (which broadcasts settings-updated
  // to every video element).
  toggleSubtitles() {
    if (this.nativeCaptionsController.controllingDisplay) {
      this.nativeCaptionsController.toggleNativeCaptions()
      return
    }

    const command: VideoToExtensionCommand<ToggleSubtitlesMessage> = {
      sender: 'asbplayer-video',
      message: {
        command: 'toggle-subtitles',
      },
      src: this.video.src,
    }

    browser.runtime.sendMessage(command)
  }

  showVideoDataDialog(openedFromMiningCommand: boolean, fromAsbplayerId?: string) {
    this.videoDataSyncController.show({
      reason: openedFromMiningCommand ? VideoDataUiOpenReason.miningCommand : VideoDataUiOpenReason.userRequested,
      fromAsbplayerId,
    })
  }

  // Called by the video-data-sync flow right before subtitles load, with the
  // selected YouTube caption track's language code (BCP-47, e.g. 'ru',
  // 'pt-BR', or this fork's synthetic 'en_from_ru' for auto-translated
  // tracks). Display-only — used to name the language if the backend reports
  // it as unsupported.
  setFlicktionarySubtitleLanguageHint(languageCode: string | undefined) {
    this._flicktionarySubtitleLanguageHint = normalizeYoutubeLanguageCode(languageCode)
  }

  // Builds the self-contained video context (metadata + canonical segments +
  // contentHash) the overlay's save and saved-highlights flows cite. Purely
  // local prep — no backend call: the session is created lazily by the first
  // save (save-word-handler's findOrCreate), so merely watching a video with
  // subtitles never creates anything server-side.
  private async _prepareFlicktionaryVideoContext(subtitles: IndexedSubtitleModel[]) {
    try {
      this._flicktionaryVideoContext = undefined
      this._flicktionarySaveDisabledReason = undefined
      if (!subtitles || subtitles.length === 0) return

      const segments = toFlicktionarySegments(subtitles)
      if (segments.length === 0) return

      const contentHash = await computeSubtitlesContentHash(segments)

      const onYoutube = isYoutubeWatchPage()

      let context: FlicktionaryVideoContext
      if (onYoutube) {
        const videoMeta = getCurrentYoutubeMetadata()
        if (!videoMeta) return
        context = {
          source: 'youtube',
          youtubeVideoId: videoMeta.youtubeVideoId,
          videoTitle: videoMeta.videoTitle,
          videoUrl: videoMeta.videoUrl,
          contentHash,
          segments,
        }
      } else {
        // Any other site (Netflix, Prime, …): identify the content by the
        // subtitle contentHash. Netflix's document.title is just "Netflix", so
        // prefer the site page-script's clean basename, then the loaded
        // subtitle's "Video Name" (always set by this point — see _updateSubtitles),
        // then the page title. url is the page URL.
        const meta = getCurrentStreamingMetadata()
        context = {
          source: 'streaming',
          videoTitle: pickStreamingTitle(
            this.videoDataSyncController.videoBasename,
            this.subtitleFileName(0),
            meta.videoTitle
          ),
          videoUrl: meta.videoUrl,
          contentHash,
          segments,
        }
      }
      this._flicktionaryVideoContext = context
    } catch (error) {
      // Don't let context-prep failures break subtitle rendering — saving is
      // simply unavailable for the video (the overlay surfaces that).
      console.warn('[flicktionary] preparing video context failed', error)
    }
  }

  async cropAndResize(tabImageDataUrl: string): Promise<string> {
    const rect = this.video.getBoundingClientRect()
    const maxWidth = this.maxImageWidth
    const maxHeight = this.maxImageHeight
    return await cropAndResize(maxWidth, maxHeight, rect, tabImageDataUrl)
  }

  // userRequested: whether the user explicitly loaded these subtitles (dialog
  // confirm, file open/drop, generate) as opposed to the silent auto-sync —
  // governs whether a native caption control is forced ON or adopted as-is.
  async loadSubtitles(files: File[], flatten: boolean, userRequested = true, syncWithAsbplayerId?: string) {
    const {
      streamingSubtitleListPreference,
      subtitleRegexFilter,
      subtitleRegexFilterTextReplacement,
      rememberSubtitleOffset,
      lastSubtitleOffset,
      subtitleHtml,
      convertNetflixRuby: convertNetflixRuby,
    } = await this.settings.get([
      'streamingSubtitleListPreference',
      'subtitleRegexFilter',
      'subtitleRegexFilterTextReplacement',
      'rememberSubtitleOffset',
      'lastSubtitleOffset',
      'subtitleHtml',
      'convertNetflixRuby',
    ])
    const syncWithAsbplayerTab = async (withSyncedAsbplayerOnly: boolean, withAsbplayerId: string | undefined) => {
      const syncMessage: VideoToExtensionCommand<ExtensionSyncMessage> = {
        sender: 'asbplayer-video',
        message: {
          command: 'sync',
          subtitles: await Promise.all(
            files.map(async (f) => {
              const base64 = await bufferToBase64(await f.arrayBuffer())

              return {
                name: f.name,
                base64: base64,
              }
            })
          ),
          withSyncedAsbplayerOnly,
          withAsbplayerId,
        },
        src: this.video.src,
      }
      browser.runtime.sendMessage(syncMessage)
    }

    switch (streamingSubtitleListPreference) {
      case SubtitleListPreference.noSubtitleList:
        const reader = new SubtitleReader({
          regexFilter: subtitleRegexFilter,
          regexFilterTextReplacement: subtitleRegexFilterTextReplacement,
          subtitleHtml: subtitleHtml,
          convertNetflixRuby: convertNetflixRuby,
        })
        const offset = rememberSubtitleOffset ? lastSubtitleOffset : 0
        const subtitles = await reader.subtitles(files, flatten)
        this._updateSubtitles(
          subtitles.map((s, index) => ({
            start: s.start + offset,
            end: s.end + offset,
            text: s.text,
            track: s.track,
            index,
            originalStart: s.start,
            originalEnd: s.end,
          })),
          flatten ? [files[0].name] : files.map((f) => f.name),
          userRequested
        )
        // If target asbplayer is not specified, then sync with any already-synced asbplayer
        // Otherwise, sync with the target asbplayer
        const withSyncedAsbplayerOnly = syncWithAsbplayerId === undefined
        syncWithAsbplayerTab(withSyncedAsbplayerOnly, syncWithAsbplayerId)
        break
      case SubtitleListPreference.app:
        syncWithAsbplayerTab(false, undefined)
        break
    }
  }

  private _updateSubtitles(subtitles: IndexedSubtitleModel[], subtitleFileNames: string[], userRequested = false) {
    this.subtitleController.subtitles = subtitles
    this.subtitleController.subtitleFileNames = subtitleFileNames

    // Keep the React overlay hosts in sync with the freshly-loaded subtitles.
    this.subtitleController.ensureReactOverlays(this._flicktionaryClosures())

    // Fire-and-forget: snapshot the video context (segments + contentHash) the
    // overlay needs for saved-highlight lookups and saves. Local-only — the
    // backend session is created lazily on the first save.
    void this._prepareFlicktionaryVideoContext(subtitles)

    if (this._playMode !== PlayMode.normal && (!subtitles || subtitles.length === 0)) {
      this.playMode = PlayMode.normal
    }

    this.subtitleController.notifySubtitlesLoaded(userRequested)
    this._synced = true
    this._syncedTimestamp = Date.now()

    // Hand the subtitle toggle to the site's native caption control if the
    // page script implements the protocol and reports one (YouTube's CC
    // button); otherwise this is a no-op and the overlay toggle stays.
    if (subtitles.length > 0 && this.hasPageScript) {
      this.nativeCaptionsController.activate({ revealSubtitles: userRequested })
    } else {
      this.nativeCaptionsController.deactivate()
    }

    if (this.video.paused) {
      this.videoOverlayController.show()
    }

    this.videoOverlayController.updateModel()

    if (subtitles.length > 0) {
      this.settings
        .get(['streamingDisplaySubtitles', 'keyBindSet'])
        .then(({ streamingDisplaySubtitles, keyBindSet }) => {
          if (!streamingDisplaySubtitles && keyBindSet.toggleSubtitles.keys) {
            this.subtitleController.notification('info.toggleSubtitlesShortcut', {
              keys: keyBindSet.toggleSubtitles.keys,
            })
          }
        })
    }

    shouldShowUpdateAlert().then((shouldShowUpdateAlert) => {
      if (shouldShowUpdateAlert) {
        this.notificationController.updateAlert(browser.runtime.getManifest().version)
      }
    })
  }

  private _resetSubtitles() {
    this.subtitleController.reset()
    this._synced = false
    this._syncedTimestamp = undefined
    this.nativeCaptionsController.deactivate()
    this.videoOverlayController.disposeOverlay()
  }

  private _notifyRequestingActiveTabPermission(requesting: boolean) {
    const command: VideoToExtensionCommand<RequestingActiveTabPermsisionMessage> = {
      sender: 'asbplayer-video',
      message: {
        command: 'requesting-active-tab-permission',
        requesting,
      },
      src: this.video.src,
    }

    browser.runtime.sendMessage(command)
  }

  url(start: number, end?: number) {
    if (youtube) {
      const toSeconds = (ms: number) => Math.floor(ms / 1000)
      const videoId = new URLSearchParams(window.location.search).get('v')

      if (videoId !== null) {
        const embedUrl = `https://www.youtube.com/embed/${videoId}?start=${toSeconds(start)}&autoplay=1`
        return end === undefined ? embedUrl : `${embedUrl}&end=${toSeconds(end)}`
      }
    }

    return window.location !== window.parent.location ? document.referrer : document.location.href
  }
}
