import {
  AutoPauseContext,
  CopyToClipboardMessage,
  OffsetFromVideoMessage,
  SubtitleModel,
  VideoToExtensionCommand,
  IndexedSubtitleModel,
} from '@asbplayer-fork/common'
import {
  SettingsProvider,
  SubtitleAlignment,
  SubtitleSettings,
  TextSubtitleSettings,
  allTextSubtitleSettings,
} from '@asbplayer-fork/common/settings'
import { SubtitleCollection, SubtitleSlice } from '@asbplayer-fork/common/subtitle-collection'
import { arrayEquals, computeStyles, computeStyleString, surroundingSubtitles } from '@asbplayer-fork/common/util'
import { i18n } from '@/ui/lingui'
import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import type { CSSProperties } from 'react'
import { CachingElementOverlay, ElementOverlay, ElementOverlayParams, OffsetAnchor } from '../services/element-overlay'
import { SubtitleStore, SubtitleLineModel } from '../ui/video-overlay/subtitle-store'
import { mountSubtitleOverlay, OverlayMountHandle } from '../ui/video-overlay/mount'
import { dispatchToast, setToasterTheme } from '../ui/video-overlay/toaster-host'
import { FlicktionaryVideoClosures } from '../services/flicktionary/flicktionary-client'
import { toast } from 'sonner'

const BOUNDING_BOX_PADDING = 25

// Marks the React popover roots (preview gloss AND saved-mode — the save
// handoff morphs one into the other, and hovering a saved span opens the
// saved-mode popover directly) so the pause-on-hover resume check can find
// them (see `intersects`). Kept in sync with GlossTooltip.tsx.
const GLOSS_POPOVER_SELECTOR = '[data-flicktionary-gloss-popover], [data-flicktionary-saved-popover]'

const _intersects = (clientX: number, clientY: number, element: HTMLElement): boolean => {
  const rect = element.getBoundingClientRect()
  return (
    clientX >= rect.x - BOUNDING_BOX_PADDING &&
    clientX <= rect.x + rect.width + BOUNDING_BOX_PADDING &&
    clientY >= rect.y - BOUNDING_BOX_PADDING &&
    clientY <= rect.y + rect.height + BOUNDING_BOX_PADDING
  )
}

// React mode can drive one or two overlay hosts at once — a bottom and/or a top
// overlay — so dual subtitles render in their correct screen positions (each
// ElementOverlay already owns its bottom/top positioning). Tracks are routed to
// a host by their per-track alignment.
type ReactOverlayKind = 'bottom' | 'top'
interface ReactOverlayHandle {
  store: SubtitleStore
  mount: OverlayMountHandle
}

export default class SubtitleController {
  private readonly video: HTMLMediaElement
  private readonly settings: SettingsProvider

  private showingSubtitles?: IndexedSubtitleModel[]
  private lastOffsetChangeTimestamp: number
  private showingOffset?: number
  private subtitlesInterval?: NodeJS.Timeout
  private subtitleSettings?: SubtitleSettings
  private subtitleStyles?: string[]
  // Object-form styles (computeStyles, NOT computeStyleString) for the React
  // overlay — zero `!important`, applied inline so they win inside the shadow
  // root in both fullscreen states. Parallel to subtitleStyles by track.
  private subtitleStyleObjects?: CSSProperties[]
  private subtitleClasses?: string[]
  private subtitleCollection: SubtitleCollection<IndexedSubtitleModel>
  private _subtitles: IndexedSubtitleModel[] = []
  private bottomSubtitlesElementOverlay: ElementOverlay
  private topSubtitlesElementOverlay: ElementOverlay
  private shouldRenderBottomOverlay: boolean
  private shouldRenderTopOverlay: boolean
  private subtitleTrackAlignments: { [key: number]: SubtitleAlignment | undefined }
  private unblurredSubtitleTracks: { [key: number]: boolean | undefined }
  disabledSubtitleTracks: { [key: number]: boolean | undefined }
  subtitleFileNames?: string[]
  _forceHideSubtitles: boolean
  _displaySubtitles: boolean
  surroundingSubtitlesCountRadius: number
  surroundingSubtitlesTimeRadius: number
  autoCopyCurrentSubtitle: boolean
  refreshCurrentSubtitle: boolean
  _preCacheDom

  // React + Shadow DOM overlay — the ONLY renderer. The loop pushes cues to the
  // per-alignment stores; there is no legacy DOM path. Binding keeps these hosts
  // in sync with the current alignment via ensureReactOverlays(). One mount per
  // active overlay (bottom and/or top) keyed by alignment.
  private _reactOverlays: Partial<Record<ReactOverlayKind, ReactOverlayHandle>> = {}

  readonly autoPauseContext: AutoPauseContext = new AutoPauseContext()

  onNextToShow?: (subtitle: SubtitleModel) => void
  onSlice?: (subtitle: SubtitleSlice<IndexedSubtitleModel>) => void
  onOffsetChange?: () => void
  onMouseOver?: (event: MouseEvent) => void
  onMouseOut?: (event: MouseEvent) => void

  constructor(video: HTMLMediaElement, settings: SettingsProvider) {
    this.video = video
    this.settings = settings
    this._preCacheDom = false
    this.showingSubtitles = []
    this.shouldRenderBottomOverlay = true
    this.shouldRenderTopOverlay = false
    this.unblurredSubtitleTracks = {}
    this.disabledSubtitleTracks = {}
    this.subtitleTrackAlignments = { 0: 'bottom' }
    this._forceHideSubtitles = false
    this._displaySubtitles = true
    this.lastOffsetChangeTimestamp = 0
    this.showingOffset = undefined
    this.surroundingSubtitlesCountRadius = 1
    this.surroundingSubtitlesTimeRadius = 5000
    this.autoCopyCurrentSubtitle = false
    this.refreshCurrentSubtitle = false
    const { subtitlesElementOverlay, topSubtitlesElementOverlay } = this._overlays()
    this.bottomSubtitlesElementOverlay = subtitlesElementOverlay
    this.topSubtitlesElementOverlay = topSubtitlesElementOverlay
    this.subtitleCollection = new SubtitleCollection<IndexedSubtitleModel>({
      returnNextToShow: true,
      showingCheckRadiusMs: 150,
    })
  }

  get subtitles() {
    return this._subtitles
  }

  set subtitles(subtitles) {
    this._subtitles = subtitles
    this.subtitleCollection.setSubtitles(subtitles)
    this.autoPauseContext.clear()
  }

  // Keep the React + Shadow overlay hosts in sync with the current per-track
  // alignment. Called by Binding after settings/subtitles are applied. React is
  // the only renderer, so this just (re)mounts the hosts: mount when none exist,
  // remount when the active bottom/top set changed (e.g. the user toggled a
  // track to dual-subtitle). No eligibility gate.
  ensureReactOverlays(closures: FlicktionaryVideoClosures) {
    const mounted = Object.keys(this._reactOverlays).length > 0
    if (!mounted) {
      this._mountReactOverlays(closures)
    } else if (this._reactMountsStale()) {
      this._unmountReactOverlays()
      this._mountReactOverlays(closures)
    }
  }

  // The overlays to drive, from the current per-track alignment: bottom and/or
  // top (dual subtitles mount both).
  private _activeReactKinds(): ReactOverlayKind[] {
    const kinds: ReactOverlayKind[] = []
    if (this.shouldRenderBottomOverlay) kinds.push('bottom')
    if (this.shouldRenderTopOverlay) kinds.push('top')
    return kinds
  }

  private _reactOverlayTarget(kind: ReactOverlayKind): ElementOverlay {
    return kind === 'bottom' ? this.bottomSubtitlesElementOverlay : this.topSubtitlesElementOverlay
  }

  private _reactMountsStale(): boolean {
    const mounted = Object.keys(this._reactOverlays) as ReactOverlayKind[]
    const active = this._activeReactKinds()
    if (mounted.length !== active.length) return true
    return active.some((kind) => !this._reactOverlays[kind])
  }

  private _mountReactOverlays(closures: FlicktionaryVideoClosures) {
    for (const kind of this._activeReactKinds()) {
      const overlay = this._reactOverlayTarget(kind)
      if (!(overlay instanceof CachingElementOverlay)) {
        continue
      }
      // Stand up a fresh persistent React host on a clean slate.
      overlay.hide()
      const host = overlay.mountPersistentHost()
      const store = new SubtitleStore()
      const mount = mountSubtitleOverlay(host, {
        store,
        video: this.video as HTMLVideoElement,
        closures,
      })
      this._reactOverlays[kind] = { store, mount }
    }

    // Force the loop to re-push current subtitles into the stores next tick.
    this.showingSubtitles = undefined
  }

  private _unmountReactOverlays() {
    for (const kind of Object.keys(this._reactOverlays) as ReactOverlayKind[]) {
      this._reactOverlays[kind]?.mount.unmount()
      const overlay = this._reactOverlayTarget(kind)
      if (overlay instanceof CachingElementOverlay) {
        overlay.disposePersistentHost()
      }
    }
    this._reactOverlays = {}
  }

  private _forEachReactStore(fn: (store: SubtitleStore) => void) {
    for (const kind of Object.keys(this._reactOverlays) as ReactOverlayKind[]) {
      const handle = this._reactOverlays[kind]
      if (handle) fn(handle.store)
    }
  }

  // The transient "+250 ms" offset indicator anchors to a single overlay
  // (bottom when present) — showing it on both would duplicate the line.
  private _setReactOffsetText(text: string | null) {
    const handle = this._reactOverlays.bottom ?? this._reactOverlays.top
    handle?.store.setOffsetText(text)
  }

  reset() {
    this.subtitles = []
    this.subtitleFileNames = undefined
    this._forEachReactStore((store) => store.reset())
  }

  get bottomSubtitlePositionOffset(): number {
    return this.bottomSubtitlesElementOverlay.contentPositionOffset
  }

  set bottomSubtitlePositionOffset(value: number) {
    this.bottomSubtitlesElementOverlay.contentPositionOffset = value
  }

  get topSubtitlePositionOffset(): number {
    return this.topSubtitlesElementOverlay.contentPositionOffset
  }

  set topSubtitlePositionOffset(value: number) {
    this.topSubtitlesElementOverlay.contentPositionOffset = value
  }

  set subtitlesWidth(value: number) {
    this.bottomSubtitlesElementOverlay.contentWidthPercentage = value
    this.topSubtitlesElementOverlay.contentWidthPercentage = value
  }

  // Keep the page-global sonner toaster in sync with the extension's themeType.
  // Raw setting value — 'system' is resolved inside setToasterTheme.
  set toasterTheme(theme: 'dark' | 'light' | 'system') {
    setToasterTheme(theme)
  }

  setSubtitleSettings(newSubtitleSettings: SubtitleSettings) {
    const styles = this._computeStyles(newSubtitleSettings)
    const classes = this._computeClasses(newSubtitleSettings)
    if (
      this.subtitleStyles === undefined ||
      !arrayEquals(styles, this.subtitleStyles, (a, b) => a === b) ||
      this.subtitleClasses === undefined ||
      !arrayEquals(classes, this.subtitleClasses, (a, b) => a === b)
    ) {
      this.subtitleStyles = styles
      this.subtitleClasses = classes
      // Object-form styles for the React overlay (string `styles` are compared
      // above for change detection; the objects are derived from the same
      // settings so they change in lockstep).
      this.subtitleStyleObjects = this._computeStyleObjects(newSubtitleSettings)
      // Invalidate the showing set so the loop re-pushes lines with the new
      // inline styles / blur classes.
      this.showingSubtitles = undefined
    }

    const newAlignments = allTextSubtitleSettings(newSubtitleSettings).map((s) => s.subtitleAlignment)
    if (!arrayEquals(newAlignments, Object.values(this.subtitleTrackAlignments), (a, b) => a === b)) {
      this.subtitleTrackAlignments = newAlignments
      this.shouldRenderBottomOverlay = Object.values(this.subtitleTrackAlignments).includes(
        'bottom' as SubtitleAlignment
      )
      this.shouldRenderTopOverlay = Object.values(this.subtitleTrackAlignments).includes('top' as SubtitleAlignment)
      const { subtitleOverlayParams, topSubtitleOverlayParams } = this._elementOverlayParams()
      this._applyElementOverlayParams(this.bottomSubtitlesElementOverlay, subtitleOverlayParams)
      this._applyElementOverlayParams(this.topSubtitlesElementOverlay, topSubtitleOverlayParams)
      this.bottomSubtitlesElementOverlay.hide()
      this.topSubtitlesElementOverlay.hide()
    }

    this.unblurredSubtitleTracks = {}

    this.subtitleSettings = newSubtitleSettings
  }

  private _computeStyles(settings: SubtitleSettings) {
    return allTextSubtitleSettings(settings).map((s) => computeStyleString(s))
  }

  private _computeStyleObjects(settings: SubtitleSettings): CSSProperties[] {
    // computeStyles emits an absolute font-size and the rest of the glyph
    // styling as a React-shaped object (no `!important`); filtering of numeric
    // keys that crash React is already done inside it.
    return allTextSubtitleSettings(settings).map((s) => computeStyles(s) as CSSProperties)
  }

  private _reactStyleForTrack(track?: number): CSSProperties {
    if (this.subtitleStyleObjects === undefined) {
      return {}
    }
    if (track === undefined) {
      return this.subtitleStyleObjects[0] ?? {}
    }
    return this.subtitleStyleObjects[track] ?? this.subtitleStyleObjects[0] ?? {}
  }

  private _pushReactSubtitles(showingSubtitles: IndexedSubtitleModel[]) {
    for (const kind of Object.keys(this._reactOverlays) as ReactOverlayKind[]) {
      const handle = this._reactOverlays[kind]
      if (!handle) continue
      const lines: SubtitleLineModel[] = showingSubtitles
        .filter((subtitle) => this._getSubtitleTrackAlignment(subtitle.track) === kind)
        .map((subtitle) => ({
          index: subtitle.index,
          track: subtitle.track ?? 0,
          text: subtitle.text,
          style: this._reactStyleForTrack(subtitle.track),
          blurred: this._trackBlurEnabled(subtitle.track) && this.unblurredSubtitleTracks[subtitle.track ?? 0] !== true,
        }))
      handle.store.setLines(lines)
    }
  }

  private _computeClasses(settings: SubtitleSettings) {
    return allTextSubtitleSettings(settings).map((s) => this._computeClassesForTrack(s))
  }

  private _computeClassesForTrack(settings: TextSubtitleSettings) {
    return settings.subtitleBlur ? 'asbplayer-subtitles-blurred' : ''
  }

  // Whether subtitle-blur is enabled for a track — the React equivalent of the
  // legacy `asbplayer-subtitles-blurred` class lookup (same per-track source).
  private _trackBlurEnabled(track?: number): boolean {
    if (this.subtitleClasses === undefined) return false
    const cls = this.subtitleClasses[track ?? 0] ?? this.subtitleClasses[0] ?? ''
    return cls === 'asbplayer-subtitles-blurred'
  }

  private _getSubtitleTrackAlignment(trackIndex: number) {
    return this.subtitleTrackAlignments[trackIndex] || this.subtitleTrackAlignments[0]
  }

  private _applyElementOverlayParams(overlay: ElementOverlay, params: ElementOverlayParams) {
    overlay.offsetAnchor = params.offsetAnchor
    overlay.fullscreenContainerClassName = params.fullscreenContainerClassName
    overlay.nonFullscreenContainerClassName = params.nonFullscreenContainerClassName
  }

  set displaySubtitles(displaySubtitles: boolean) {
    this._displaySubtitles = displaySubtitles
    this.showingSubtitles = undefined
  }

  set forceHideSubtitles(forceHideSubtitles: boolean) {
    this._forceHideSubtitles = forceHideSubtitles
    this.showingSubtitles = undefined
  }

  private _overlays() {
    const { subtitleOverlayParams, topSubtitleOverlayParams } = this._elementOverlayParams()

    return {
      subtitlesElementOverlay: new CachingElementOverlay(subtitleOverlayParams),
      topSubtitlesElementOverlay: new CachingElementOverlay(topSubtitleOverlayParams),
    }
  }

  private _elementOverlayParams() {
    const subtitleOverlayParams: ElementOverlayParams = {
      targetElement: this.video,
      nonFullscreenContainerClassName: 'asbplayer-subtitles-container-bottom',
      fullscreenContainerClassName: 'asbplayer-subtitles-container-bottom',
      offsetAnchor: OffsetAnchor.bottom,
      contentWidthPercentage: -1,
      onMouseOver: (event: MouseEvent) => this.onMouseOver?.(event),
      onMouseOut: (event: MouseEvent) => this.onMouseOut?.(event),
    }
    const topSubtitleOverlayParams: ElementOverlayParams = {
      targetElement: this.video,
      nonFullscreenContainerClassName: 'asbplayer-subtitles-container-top',
      fullscreenContainerClassName: 'asbplayer-subtitles-container-top',
      offsetAnchor: OffsetAnchor.top,
      contentWidthPercentage: -1,
      onMouseOver: (event: MouseEvent) => this.onMouseOver?.(event),
      onMouseOut: (event: MouseEvent) => this.onMouseOut?.(event),
    }

    return { subtitleOverlayParams, topSubtitleOverlayParams }
  }

  bind() {
    this.subtitlesInterval = setInterval(() => {
      if (this.subtitles.length === 0) {
        return
      }

      const showOffset = this.lastOffsetChangeTimestamp > 0 && Date.now() - this.lastOffsetChangeTimestamp < 1000
      const offset = showOffset ? this._computeOffset() : 0
      const slice = this.subtitleCollection.subtitlesAt(this.video.currentTime * 1000)
      const showingSubtitles = this._findShowingSubtitles(slice)

      this.onSlice?.(slice)

      if (slice.willStopShowing && this._trackEnabled(slice.willStopShowing)) {
        this.autoPauseContext.willStopShowing(slice.willStopShowing)
      }

      if (slice.startedShowing && this._trackEnabled(slice.startedShowing)) {
        this.autoPauseContext.startedShowing(slice.startedShowing)
      }

      if (slice.nextToShow && slice.nextToShow.length > 0) {
        this.onNextToShow?.(slice.nextToShow[0])
      }

      const subtitlesAreNew =
        this.showingSubtitles === undefined ||
        !arrayEquals(showingSubtitles, this.showingSubtitles, (a, b) => a.index === b.index)

      if (subtitlesAreNew) {
        this.showingSubtitles = showingSubtitles
        this._autoCopyToClipboard(showingSubtitles)
      }

      const shouldRenderOffset =
        (showOffset && offset !== this.showingOffset) || (!showOffset && this.showingOffset !== undefined)

      if ((!showOffset && !this._displaySubtitles) || this._forceHideSubtitles) {
        // Don't call hide() — that would dispose the host and leak the React
        // root. Hiding goes through a store flag (the app renders nothing); the
        // containers + host stay mounted.
        this._forEachReactStore((store) => store.setVisible(false))
      } else if (subtitlesAreNew || shouldRenderOffset || this.refreshCurrentSubtitle) {
        if (this.refreshCurrentSubtitle) this.refreshCurrentSubtitle = false

        // A new cue re-blurs any track the unblur keybind had revealed.
        if (subtitlesAreNew) {
          this.unblurredSubtitleTracks = {}
        }
        this._forEachReactStore((store) => store.setVisible(true))
        // Route every showing cue to its overlay (bottom/top) by alignment.
        this._pushReactSubtitles(showingSubtitles)

        if (showOffset) {
          this._setReactOffsetText(this._formatOffset(offset))
          this.showingOffset = offset
        } else {
          this._setReactOffsetText(null)
          this.showingOffset = undefined
        }
      }
    }, 100)
  }

  private _autoCopyToClipboard(subtitles: SubtitleModel[]) {
    if (this.autoCopyCurrentSubtitle && subtitles.length > 0 && document.hasFocus()) {
      const text = subtitles
        .map((s) => s.text)
        .filter((text) => text !== '')
        .join('\n')

      if (text !== '') {
        const command: VideoToExtensionCommand<CopyToClipboardMessage> = {
          sender: 'asbplayer-video',
          message: {
            command: 'copy-to-clipboard',
            dataUrl: `data:,${encodeURIComponent(text)}`,
          },
          src: this.video.src,
        }

        browser.runtime.sendMessage(command)
      }
    }
  }

  private _findShowingSubtitles(slice: SubtitleSlice<IndexedSubtitleModel>): IndexedSubtitleModel[] {
    return slice.showing.filter((s) => this._trackEnabled(s)).sort((s1, s2) => s1.track - s2.track)
  }

  private _trackEnabled(subtitle: SubtitleModel) {
    return subtitle.track === undefined || !this.disabledSubtitleTracks[subtitle.track]
  }

  unbind() {
    // Unmount the React root + dispose the persistent host BEFORE the overlay's
    // own dispose() tears down the containers, so the root is cleanly unmounted.
    this._unmountReactOverlays()

    if (this.subtitlesInterval) {
      clearInterval(this.subtitlesInterval)
      this.subtitlesInterval = undefined
    }

    this.bottomSubtitlesElementOverlay.dispose()
    this.topSubtitlesElementOverlay.dispose()
    this.onNextToShow = undefined
    this.onSlice = undefined
    this.onOffsetChange = undefined
    this.onMouseOver = undefined
    this.onMouseOut = undefined
  }

  refresh() {
    if (this.shouldRenderBottomOverlay) this.bottomSubtitlesElementOverlay.refresh()
    if (this.shouldRenderTopOverlay) this.topSubtitlesElementOverlay.refresh()
  }

  currentSubtitle(): [IndexedSubtitleModel | null, SubtitleModel[] | null] {
    const now = 1000 * this.video.currentTime
    let subtitle = null
    let index = null

    for (let i = 0; i < this.subtitles.length; ++i) {
      const s = this.subtitles[i]

      if (now >= s.start && now < s.end && (typeof s.track === 'undefined' || !this.disabledSubtitleTracks[s.track])) {
        subtitle = s
        index = i
        break
      }
    }

    if (subtitle === null || index === null) {
      return [null, null]
    }

    return [
      subtitle,
      surroundingSubtitles(
        this.subtitles,
        index,
        this.surroundingSubtitlesCountRadius,
        this.surroundingSubtitlesTimeRadius
      ),
    ]
  }

  unblur(track: number) {
    // Mark the track revealed and re-push so the showing lines re-render
    // unblurred. Resets on the next cue (see the loop's subtitlesAreNew path).
    this.unblurredSubtitleTracks[track] = true
    if (this.showingSubtitles) {
      this._pushReactSubtitles(this.showingSubtitles)
    }
  }

  offset(offset: number, skipNotifyPlayer = false) {
    if (!this.subtitles || this.subtitles.length === 0) {
      return
    }

    this.subtitles = this.subtitles.map((s) => ({
      text: s.text,
      start: s.originalStart + offset,
      originalStart: s.originalStart,
      end: s.originalEnd + offset,
      originalEnd: s.originalEnd,
      track: s.track,
      index: s.index,
    }))

    this.lastOffsetChangeTimestamp = Date.now()

    if (!skipNotifyPlayer) {
      const command: VideoToExtensionCommand<OffsetFromVideoMessage> = {
        sender: 'asbplayer-video',
        message: {
          command: 'offset',
          value: offset,
        },
        src: this.video.src,
      }

      browser.runtime.sendMessage(command)
    }

    this.onOffsetChange?.()

    this.settings.getSingle('rememberSubtitleOffset').then((rememberSubtitleOffset) => {
      if (rememberSubtitleOffset) {
        this.settings.set({ lastSubtitleOffset: offset })
      }
    })
  }

  private _computeOffset(): number {
    if (!this.subtitles || this.subtitles.length === 0) {
      return 0
    }

    const s = this.subtitles[0]
    return s.start - s.originalStart
  }

  private _formatOffset(offset: number): string {
    const roundedOffset = Math.floor(offset)
    return roundedOffset >= 0 ? '+' + roundedOffset + ' ms' : roundedOffset + ' ms'
  }

  // The notification overlay is driven by dotted loc-keys chosen elsewhere (see
  // services/binding.ts), so we map the known keys to lazy Lingui messages and
  // resolve them imperatively against the content-script's Lingui catalog.
  private _notificationMessage(locKey: string, r: { [key: string]: string }): MessageDescriptor {
    const { rate, message, keys } = r
    switch (locKey) {
      case 'info.enabledAutoPause':
        return msg`Auto-pause: On`
      case 'info.disabledAutoPause':
        return msg`Auto-pause: Off`
      case 'info.enabledCondensedPlayback':
        return msg`Condensed playback: On`
      case 'info.disabledCondensedPlayback':
        return msg`Condensed playback: Off`
      case 'info.enabledFastForwardPlayback':
        return msg`Fast forward playback: On`
      case 'info.disabledFastForwardPlayback':
        return msg`Fast forward playback: Off`
      case 'info.enabledRepeatPlayback':
        return msg`Repeat playback: On`
      case 'info.disabledRepeatPlayback':
        return msg`Repeat playback: Off`
      case 'info.playbackRate':
        return msg`Playback Rate: ${rate}`
      case 'info.error':
        return msg`Error: ${message}`
      case 'info.toggleSubtitlesShortcut':
        return msg`Press "${keys}" to toggle subtitle display`
      default:
        return { id: locKey }
    }
  }

  notification(locKey: string, replacements?: { [key: string]: string }) {
    const text = i18n._(this._notificationMessage(locKey, replacements ?? {}))
    dispatchToast(() => toast(text))
  }

  // One-off plain-text notice (e.g. the "saving disabled" reason on load), for
  // dynamic text that isn't a known loc-key — surfaced as an error toast since
  // it's the longer-lived "saving disabled" reason.
  showTextNotification(text: string) {
    dispatchToast(() => toast.error(text))
  }

  // Sync feedback goes through the corner toaster, not the subtitle overlay —
  // the overlay only ever renders real cues. Tracks are auto-detected in this
  // fork, so echoing file names carries no information; the case worth calling
  // out explicitly is the empty track, which would otherwise be
  // indistinguishable from a sync that silently failed.
  notifySubtitlesLoaded() {
    if (this.subtitles.length === 0) {
      dispatchToast(() => toast(i18n._(msg`No subtitles found for this video`)))
      return
    }

    const offset = this._computeOffset()
    const formattedOffset = this._formatOffset(offset)
    const text = offset !== 0 ? i18n._(msg`Subtitles loaded (${formattedOffset})`) : i18n._(msg`Subtitles loaded`)
    dispatchToast(() => toast(text))
  }

  intersects(clientX: number, clientY: number): boolean {
    const bottomContainer = this.bottomSubtitlesElementOverlay.containerElement

    if (bottomContainer !== undefined && _intersects(clientX, clientY, bottomContainer)) {
      return true
    }

    const topContainer = this.topSubtitlesElementOverlay.containerElement

    if (topContainer !== undefined && _intersects(clientX, clientY, topContainer)) {
      return true
    }

    // Hover bridge: while a React popover is open (preview gloss or
    // saved-mode), treat the pointer as still "on the subtitles" when it's
    // over the popover. Without this, moving from the hovered word up to the
    // popover (to click Save, or to edit a just-saved word's note) exits the
    // subtitle rect, auto-resumes playback, and dismisses the popover. Check
    // every mounted overlay's popover host (bottom and/or top).
    for (const kind of Object.keys(this._reactOverlays) as ReactOverlayKind[]) {
      const popover = this._reactOverlays[kind]?.mount.popoverHost?.shadowRoot?.querySelector(GLOSS_POPOVER_SELECTOR)
      if (popover instanceof HTMLElement && _intersects(clientX, clientY, popover)) {
        return true
      }
    }

    return false
  }
}
