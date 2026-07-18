import { createElement } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  VideoOverlayModel,
  type FlicktionaryCheckpointAvailabilityMessage,
  type FlicktionaryCheckpointAvailabilityResponse,
  type FlicktionaryCollectCheckpointMessage,
  type FlicktionaryCollectCheckpointResponse,
  type FlicktionaryUndoCheckpointMessage,
  type FlicktionaryUndoCheckpointResponse,
  type SaveWordFlicktionaryVideoContext,
  type TabToExtensionCommand,
} from '@asbplayer-fork/common'
import type { CheckpointFeedback } from '@asbplayer-fork/common/components/CheckpointFeedbackChip'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { msg } from '@lingui/core/macro'
import { i18n } from '../ui/lingui'
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

  // Checkpoint-review state. `_checkpointUnsupported` latches when the video's
  // (cached) session language has no wiktionary data — the button hides for
  // the rest of the binding. The feedback chip owns its own lifetime,
  // independent of the pause-controls visibility.
  private _checkpointUnsupported = false
  private _availabilityProbedKey?: string
  private _checkpointFeedbackTimeout?: ReturnType<typeof setTimeout>
  private _collectingCheckpoint = false

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
      checkpointFeedback: null,
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
      onCheckpoint: () => void this._collectCheckpoint(),
      onUndoCheckpoint: (sessionId, checkpointId) => void this._undoCheckpoint(sessionId, checkpointId),
    }
  }

  // Playback→segment mapping happens HERE, content-side: the background's
  // session cache stores no timings. subtitleController.subtitles[] carries
  // the ingested segment index per cue; the press asserts comprehension up to
  // the last cue that has STARTED by the current playback time (between cues →
  // the last ended one).
  private _currentSegmentIndex(): number | undefined {
    const subtitles = this._context.subtitleController.subtitles
    const currentMs = this._context.video.currentTime * 1000
    let index: number | undefined
    for (const subtitle of subtitles) {
      if (subtitle.start > currentMs) break
      index = subtitle.index
    }
    return index
  }

  private _setCheckpointFeedback(feedback: CheckpointFeedback | null, lifetimeMs = 8000) {
    if (this._checkpointFeedbackTimeout !== undefined) {
      clearTimeout(this._checkpointFeedbackTimeout)
      this._checkpointFeedbackTimeout = undefined
    }
    this._store?.setState({ checkpointFeedback: feedback })
    if (feedback) {
      this._checkpointFeedbackTimeout = setTimeout(() => {
        this._checkpointFeedbackTimeout = undefined
        this._store?.setState({ checkpointFeedback: null })
      }, lifetimeMs)
    }
  }

  private async _collectCheckpoint() {
    if (this._collectingCheckpoint) {
      return
    }
    const videoCtx = this._context.flicktionaryVideoContext
    if (!videoCtx) {
      return
    }
    const segmentIndex = this._currentSegmentIndex()
    if (segmentIndex === undefined) {
      this._setCheckpointFeedback({ kind: 'info', text: i18n._(msg`Nothing to collect yet.`) })
      return
    }

    this._collectingCheckpoint = true
    try {
      const command: TabToExtensionCommand<FlicktionaryCollectCheckpointMessage> = {
        sender: 'asbplayer-video-tab',
        message: {
          command: 'flicktionary-collect-checkpoint',
          messageId: uuidv4(),
          segmentIndex,
          flicktionaryVideo: videoCtx,
        },
      }
      // `response` is undefined if no background handler answered (service
      // worker mid-reload) — treat as a retryable failure, never crash.
      const response: FlicktionaryCollectCheckpointResponse | undefined = await browser.runtime.sendMessage(command)
      if (response?.success) {
        if (response.checkpointId && response.sessionId && (response.creditedCount ?? 0) > 0) {
          this._setCheckpointFeedback({
            kind: 'success',
            creditedCount: response.creditedCount ?? 0,
            sessionId: response.sessionId,
            checkpointId: response.checkpointId,
          })
        } else {
          this._setCheckpointFeedback({ kind: 'info', text: i18n._(msg`No new reviews to collect.`) })
        }
        return
      }
      if (response?.code === 'UNSUPPORTED_LANGUAGE') {
        // Latch + hide the button: the language won't become supported
        // mid-video.
        this._checkpointUnsupported = true
        void this._pushModel()
        this._setCheckpointFeedback({
          kind: 'info',
          text: i18n._(msg`Review collection isn't available for this language yet.`),
        })
        return
      }
      if (response?.code === 'NEEDS_ONBOARDING') {
        this._setCheckpointFeedback({
          kind: 'error',
          text: i18n._(msg`Finish setting up Flicktionary on flicktionary.app first.`),
        })
        return
      }
      if (response?.code === 'MISSING_CEFR') {
        this._setCheckpointFeedback({
          kind: 'error',
          text: i18n._(msg`Set your level for this language on flicktionary.app first.`),
        })
        return
      }
      this._setCheckpointFeedback({
        kind: 'error',
        text: response?.error || i18n._(msg`Could not collect reviews. Try again.`),
      })
    } finally {
      this._collectingCheckpoint = false
    }
  }

  private async _undoCheckpoint(sessionId: string, checkpointId: string) {
    const command: TabToExtensionCommand<FlicktionaryUndoCheckpointMessage> = {
      sender: 'asbplayer-video-tab',
      message: {
        command: 'flicktionary-undo-checkpoint',
        messageId: uuidv4(),
        sessionId,
        checkpointId,
      },
    }
    const response: FlicktionaryUndoCheckpointResponse | undefined = await browser.runtime.sendMessage(command)
    if (response?.success && response.undone) {
      this._setCheckpointFeedback({ kind: 'info', text: i18n._(msg`Reviews restored.`) }, 4000)
    } else {
      this._setCheckpointFeedback({
        kind: 'error',
        text: response?.error || i18n._(msg`Could not undo. The reviews may have changed since.`),
      })
    }
  }

  // One cache-only probe per video context: if the CACHED session's language is
  // known-unsupported, the button never shows. Before first registration the
  // language is unknown — the button shows and the press reports the outcome.
  private async _probeCheckpointAvailability(videoCtx: SaveWordFlicktionaryVideoContext | undefined) {
    if (!videoCtx) {
      return
    }
    const key = `${videoCtx.source}:${videoCtx.contentHash}`
    if (this._availabilityProbedKey === key) {
      return
    }
    this._availabilityProbedKey = key
    this._checkpointUnsupported = false
    try {
      const command: TabToExtensionCommand<FlicktionaryCheckpointAvailabilityMessage> = {
        sender: 'asbplayer-video-tab',
        message: {
          command: 'flicktionary-checkpoint-availability',
          messageId: uuidv4(),
          source: videoCtx.source,
          contentHash: videoCtx.contentHash,
        },
      }
      const response: FlicktionaryCheckpointAvailabilityResponse | undefined =
        await browser.runtime.sendMessage(command)
      const cachedLanguage = response?.cachedTargetLanguage
      if (cachedLanguage && !KAIKKI_LANGUAGES.has(cachedLanguage)) {
        this._checkpointUnsupported = true
      }
    } catch {
      // Probe is best-effort; the press itself still reports outcomes.
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
    const videoCtx = this._context.flicktionaryVideoContext
    await this._probeCheckpointAvailability(videoCtx)
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
      // No subtitle track → no button (nothing to assert comprehension over);
      // known-unsupported cached language → no button either.
      checkpointAvailable: subtitles.length > 0 && videoCtx !== undefined && !this._checkpointUnsupported,
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
    this._setCheckpointFeedback(null)
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
    if (this._checkpointFeedbackTimeout !== undefined) {
      clearTimeout(this._checkpointFeedbackTimeout)
      this._checkpointFeedbackTimeout = undefined
    }
    this._unmountShadow()
    this._store = undefined
    this._showing = false
    this._bound = false
  }
}
