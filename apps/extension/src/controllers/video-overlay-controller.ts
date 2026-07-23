import { createElement } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  VideoOverlayModel,
  type FlicktionaryCheckpointAvailabilityMessage,
  type FlicktionaryCheckpointAvailabilityResponse,
  type FlicktionaryCollectCheckpointMessage,
  type FlicktionaryCollectCheckpointResponse,
  type FlicktionaryDeclarationPreviewMessage,
  type FlicktionaryDeclarationPreviewResponse,
  type FlicktionaryMarkKnownMessage,
  type FlicktionaryMarkKnownResponse,
  type FlicktionaryUndoCheckpointMessage,
  type FlicktionaryUndoCheckpointResponse,
  type FlicktionaryUnmarkKnownMessage,
  type FlicktionaryUnmarkKnownResponse,
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
import type { CollectOutcome, SweepOutcome } from '../ui/video-overlay/declaration-sheet'

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
  // A conflict re-snapshot re-fires the preview without changing the run — the
  // monotonic id drops a slower earlier response landing after a fresher one.
  private _declarationPreviewRequestId = 0
  // Passive mark-known badge on the paused controls: read-only probe, keyed by
  // the segment index it was fetched for so repeated pauses at the same spot
  // don't refetch.
  private _badgeRequestId = 0
  private _badgeProbedSegmentIndex?: number

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
      declaration: null,
      markKnownBadge: null,
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
      onCheckpoint: () => this._openDeclarationSheet(),
      onDeclarationCollect: () => this._collectCheckpoint(),
      onDeclarationRefreshSnapshot: () => this._refreshDeclarationSnapshot(),
      onDeclarationSweep: () => this._sweepDeclaration(),
      onDeclarationUndoSweep: (sweepBatchId) => this._undoSweep(sweepBatchId),
      onDeclarationUndoCheckpoint: (checkpointId) => this._undoCheckpoint(checkpointId),
      onDeclarationClose: () => this._closeDeclarationSheet(),
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

  // Every declaration round trip goes through here: the promise NEVER rejects
  // (a rejection reaching the sheet's finally would clear its busy flag with
  // no failure state) — worker teardown, Firefox rejections and missing
  // handlers all collapse to `undefined`, which callers map to soft failures.
  private async _sendDeclarationMessage<TResponse>(
    message: TabToExtensionCommand<
      | FlicktionaryDeclarationPreviewMessage
      | FlicktionaryCollectCheckpointMessage
      | FlicktionaryMarkKnownMessage
      | FlicktionaryUnmarkKnownMessage
      | FlicktionaryUndoCheckpointMessage
    >['message']
  ): Promise<TResponse | undefined> {
    const command = { sender: 'asbplayer-video-tab' as const, message }
    try {
      return await browser.runtime.sendMessage(command)
    } catch {
      return undefined
    }
  }

  private _declaration() {
    return this._store?.getState().declaration ?? null
  }

  private _openDeclarationSheet() {
    const store = this._store
    const videoCtx = this._context.flicktionaryVideoContext
    if (!store || !videoCtx) {
      return
    }
    const segmentIndex = this._currentSegmentIndex()
    if (segmentIndex === undefined) {
      this._setCheckpointFeedback({ kind: 'info', text: i18n._(msg`Nothing to collect yet.`) })
      return
    }
    const runKey = (this._declaration()?.runKey ?? 0) + 1
    store.setState({ declaration: { runKey, segmentIndex, preview: { status: 'loading' } } })
    void this._fetchDeclarationPreview(runKey, segmentIndex, videoCtx)
  }

  private _closeDeclarationSheet() {
    this._store?.setState({ declaration: null })
    // A sweep (or its undo) changes the markable count — re-key the paused
    // controls' badge to fresh numbers.
    this._badgeProbedSegmentIndex = undefined
    void this._probeMarkKnownBadge()
  }

  // The web pill's ambient sweep count, scoped to pause: a READ-ONLY probe
  // (pausing is not an explicit act — it must never create a session) that
  // feeds the controls-bar mark-known badge. All failures are silent: no
  // session yet, signed out, or a non-ready profile simply mean no badge.
  private async _probeMarkKnownBadge() {
    const store = this._store
    const videoCtx = this._context.flicktionaryVideoContext
    if (!store || !videoCtx || !this._showing || this._checkpointUnsupported) {
      return
    }
    const segmentIndex = this._currentSegmentIndex()
    if (segmentIndex === undefined) {
      store.setState({ markKnownBadge: null })
      return
    }
    if (this._badgeProbedSegmentIndex === segmentIndex) {
      return
    }
    this._badgeProbedSegmentIndex = segmentIndex
    const requestId = ++this._badgeRequestId
    const response = await this._sendDeclarationMessage<FlicktionaryDeclarationPreviewResponse>({
      command: 'flicktionary-declaration-preview',
      messageId: uuidv4(),
      segmentIndex,
      flicktionaryVideo: videoCtx,
      readOnly: true,
    })
    if (!this._store || requestId !== this._badgeRequestId) {
      return
    }
    if (response?.success && response.checkpointSupported === false) {
      // The passive probe learns the unsupported language before any press —
      // hide the button right away (no chip: nothing was asked for).
      this._checkpointUnsupported = true
      this._store.setState({ markKnownBadge: null })
      void this._pushModel()
      return
    }
    const count = response?.success && response.markKnownStatus === 'ready' ? (response.markableLemmaCount ?? 0) : null
    this._store.setState({ markKnownBadge: count })
    if (!response?.success) {
      // Let a later pause retry (transient failure or a session created in
      // the meantime by a save on another surface).
      this._badgeProbedSegmentIndex = undefined
    }
  }

  // After a collect CONFLICT: move the frontier to the current playback
  // position and re-key both preview counts to it — without this the sheet
  // would show the old sweep count but sweep the new span. The run itself
  // survives (same runKey, no remount).
  private _refreshDeclarationSnapshot() {
    const store = this._store
    const videoCtx = this._context.flicktionaryVideoContext
    const declaration = this._declaration()
    if (!store || !videoCtx || !declaration) {
      return
    }
    // Playback can sit before the first cue after a backwards seek — keep the
    // old frontier rather than corrupting the run.
    const segmentIndex = this._currentSegmentIndex() ?? declaration.segmentIndex
    store.setState({ declaration: { ...declaration, segmentIndex, preview: { status: 'loading' } } })
    void this._fetchDeclarationPreview(declaration.runKey, segmentIndex, videoCtx)
  }

  private async _fetchDeclarationPreview(
    runKey: number,
    segmentIndex: number,
    videoCtx: SaveWordFlicktionaryVideoContext
  ) {
    const requestId = ++this._declarationPreviewRequestId
    const response = await this._sendDeclarationMessage<FlicktionaryDeclarationPreviewResponse>({
      command: 'flicktionary-declaration-preview',
      messageId: uuidv4(),
      segmentIndex,
      flicktionaryVideo: videoCtx,
    })
    const store = this._store
    const declaration = this._declaration()
    if (!store || !declaration || declaration.runKey !== runKey || requestId !== this._declarationPreviewRequestId) {
      return
    }
    if (response?.success && response.sessionId) {
      if (response.checkpointSupported === false) {
        // An EXISTING session in an unsupported language previews fine and
        // reports unsupported as a success — same latch as the error code.
        this._closeDeclarationSheet()
        this._showCheckpointErrorChip({ code: 'UNSUPPORTED_LANGUAGE' })
        return
      }
      store.setState({
        declaration: {
          ...declaration,
          sessionId: response.sessionId,
          preview: {
            status: 'ready',
            pendingCount: response.pendingCount ?? null,
            markKnownStatus: response.markKnownStatus ?? 'failed',
            markableLemmaCount: response.markableLemmaCount ?? 0,
          },
        },
      })
      return
    }
    if (declaration.sessionId) {
      // A failed conflict re-fetch mustn't tear down a mid-flight run (the
      // collect may have just succeeded) — degrade to countless-but-usable:
      // collect stays possible, the sweep offer auto-skips.
      store.setState({
        declaration: {
          ...declaration,
          preview: { status: 'ready', pendingCount: null, markKnownStatus: 'failed', markableLemmaCount: 0 },
        },
      })
      return
    }
    // The initial preview never produced a session — the sheet has nothing to
    // act on; close it and fall back to the chip error paths.
    this._closeDeclarationSheet()
    this._showCheckpointErrorChip(response)
  }

  private async _collectCheckpoint(): Promise<CollectOutcome> {
    const videoCtx = this._context.flicktionaryVideoContext
    const declaration = this._declaration()
    if (!videoCtx || !declaration) {
      return { ok: false, reason: 'error' }
    }
    const response = await this._sendDeclarationMessage<FlicktionaryCollectCheckpointResponse>({
      command: 'flicktionary-collect-checkpoint',
      messageId: uuidv4(),
      segmentIndex: declaration.segmentIndex,
      flicktionaryVideo: videoCtx,
    })
    if (response?.success) {
      // The collect resolves the session itself, so it can supply the id the
      // preview failed to (keeps the sweep/undo lanes usable).
      const current = this._declaration()
      if (response.sessionId && current && current.runKey === declaration.runKey && !current.sessionId) {
        this._store?.setState({ declaration: { ...current, sessionId: response.sessionId } })
      }
      return { ok: true, checkpointId: response.checkpointId ?? null, creditedCount: response.creditedCount ?? 0 }
    }
    if (response?.code === 'CONFLICT') {
      return { ok: false, reason: 'conflict' }
    }
    // Coded collect failures are near-impossible after a successful preview
    // resolve, but keep the chip routing as the fallback (incl. the
    // unsupported latch).
    if (response?.code) {
      this._closeDeclarationSheet()
      this._showCheckpointErrorChip(response)
    }
    return { ok: false, reason: 'error' }
  }

  private async _sweepDeclaration(): Promise<SweepOutcome> {
    const declaration = this._declaration()
    if (!declaration?.sessionId) {
      return { ok: false }
    }
    const response = await this._sendDeclarationMessage<FlicktionaryMarkKnownResponse>({
      command: 'flicktionary-mark-known',
      messageId: uuidv4(),
      sessionId: declaration.sessionId,
      toSegmentIndex: declaration.segmentIndex,
    })
    if (response?.success) {
      return { ok: true, markedCount: response.markedCount ?? 0, sweepBatchId: response.sweepBatchId ?? null }
    }
    return { ok: false }
  }

  private async _undoSweep(sweepBatchId: string): Promise<boolean> {
    const declaration = this._declaration()
    if (!declaration?.sessionId) {
      return false
    }
    const response = await this._sendDeclarationMessage<FlicktionaryUnmarkKnownResponse>({
      command: 'flicktionary-unmark-known',
      messageId: uuidv4(),
      sessionId: declaration.sessionId,
      sweepBatchId,
    })
    return response?.success === true
  }

  private async _undoCheckpoint(checkpointId: string): Promise<{ ok: boolean; undone: boolean }> {
    const declaration = this._declaration()
    if (!declaration?.sessionId) {
      return { ok: false, undone: false }
    }
    const response = await this._sendDeclarationMessage<FlicktionaryUndoCheckpointResponse>({
      command: 'flicktionary-undo-checkpoint',
      messageId: uuidv4(),
      sessionId: declaration.sessionId,
      checkpointId,
    })
    if (!response?.success) {
      return { ok: false, undone: false }
    }
    return { ok: true, undone: response.undone === true }
  }

  private _showCheckpointErrorChip(response: { code?: string; error?: string } | undefined) {
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
    // A seek while paused moves the frontier — the badge count follows it
    // (no-op while playing or at an unchanged segment index).
    void this._probeMarkKnownBadge()
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
    // A subtitle reset invalidates the run's segment indexes — never strand an
    // open declaration sheet (or a stale badge count) over a re-syncing video.
    this._badgeProbedSegmentIndex = undefined
    this._store?.setState({
      model: undefined,
      visible: false,
      tooltipsEnabled: this._tooltipsEnabled(),
      declaration: null,
      markKnownBadge: null,
    })
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
    void this._probeMarkKnownBadge()
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
