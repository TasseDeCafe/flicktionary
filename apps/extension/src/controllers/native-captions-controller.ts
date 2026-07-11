import Binding from '../services/binding'

export interface NativeCaptionsState {
  readonly available: boolean
  readonly on: boolean
}

// Bridges a site's own caption controls (currently YouTube's CC button — see
// the native-caption section of youtube-page.ts) to the extension's subtitle
// display. The protocol is a set of document CustomEvents and is
// self-negotiating: `bind` asks the site page script to start observing its
// native control; a page script that doesn't implement the protocol never
// publishes `state`, so this controller stays dormant and the generic overlay
// toggle keeps working.
//
// While a usable native control is reported, it becomes the source of truth
// for subtitle visibility on this video: state changes land in
// SubtitleController.displaySubtitlesOverride, a per-video layer on top of the
// global streamingDisplaySubtitles setting. The setting itself is never
// written — the native CC button is deliberately video-local, so toggling it
// must not reach other tabs or other sites.
export interface NativeCaptionsActivationOptions {
  // true when the user explicitly loaded these subtitles (dialog confirm, Open
  // Files, Generate): force the native control ON so the freshly loaded
  // subtitles are visible. false for automatic loads (auto-sync on page load /
  // SPA navigation): adopt the native control's own state — YouTube persists
  // the CC choice across reloads and videos, and overwriting it with our own
  // state would make the CC toggle appear to "forget" on every reload.
  revealSubtitles: boolean
}

export default class NativeCaptionsController {
  private readonly _context: Binding
  private _stateListener?: EventListener
  private _active = false
  private _available = false
  private _nativeCaptionsOn = false
  private _revealPending = false

  constructor(context: Binding) {
    this._context = context
  }

  // Whether the native control currently drives subtitle visibility — the
  // overlay hides its own toggle button while this is true.
  get controllingDisplay() {
    return this._active && this._available
  }

  get nativeCaptionsOn() {
    return this._nativeCaptionsOn
  }

  // Called when subtitles finish loading on a page-script site. Safe to call
  // repeatedly (e.g. the user re-confirms the dialog mid-video).
  activate({ revealSubtitles }: NativeCaptionsActivationOptions) {
    if (!this._stateListener) {
      this._stateListener = (event: Event) => this._onState((event as CustomEvent).detail as NativeCaptionsState)
      document.addEventListener('asbplayer-native-captions-state', this._stateListener)
    }

    this._active = true
    this._available = false
    this._revealPending = revealSubtitles
    document.dispatchEvent(new CustomEvent('asbplayer-native-captions-bind'))
  }

  deactivate() {
    if (!this._active) {
      return
    }

    this._active = false
    this._available = false
    this._revealPending = false
    this._context.subtitleController.displaySubtitlesOverride = undefined
    document.dispatchEvent(new CustomEvent('asbplayer-native-captions-unbind'))
    void this._context.videoOverlayController.updateModel()
  }

  unbind() {
    this.deactivate()

    if (this._stateListener) {
      document.removeEventListener('asbplayer-native-captions-state', this._stateListener)
      this._stateListener = undefined
    }
  }

  // The subtitle pipeline resolved to "load nothing" for the current video:
  // release the page script's provisional (pre-bind) native-caption hide — see
  // the provisional-suppression section of youtube-page.ts. A no-op on page
  // scripts that don't implement provisional suppression, and while bound (the
  // page script only ever releases the provisional hide on this event).
  decline() {
    document.dispatchEvent(new CustomEvent('asbplayer-native-captions-decline'))
  }

  // Ask the page script to flip the native control; the resulting state event
  // (from the page's own observer) is what updates the display override.
  setNativeCaptions(on: boolean) {
    document.dispatchEvent(new CustomEvent('asbplayer-native-captions-set', { detail: on }))
  }

  toggleNativeCaptions() {
    this.setNativeCaptions(!this._nativeCaptionsOn)
  }

  private _onState(state: NativeCaptionsState | undefined) {
    if (!this._active || !state) {
      return
    }

    const wasControlling = this.controllingDisplay
    this._available = state.available === true
    this._nativeCaptionsOn = state.on === true

    if (!this._available) {
      // Native control disappeared (e.g. SPA navigation to a video without
      // caption tracks) — fall back to the global setting + overlay toggle.
      if (wasControlling) {
        this._context.subtitleController.displaySubtitlesOverride = undefined
        void this._context.videoOverlayController.updateModel()
      }
      return
    }

    if (this._revealPending) {
      // The user explicitly loaded subtitles and must see them even if their
      // native CC preference happened to be off. From here on the native
      // button is the source of truth.
      this._revealPending = false
      this._context.subtitleController.displaySubtitlesOverride = true

      if (!this._nativeCaptionsOn) {
        this.setNativeCaptions(true)
      }

      void this._context.videoOverlayController.updateModel()
      return
    }

    this._context.subtitleController.displaySubtitlesOverride = this._nativeCaptionsOn
    void this._context.videoOverlayController.updateModel()
  }
}
