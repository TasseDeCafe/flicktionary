import { createElement } from 'react'
import Binding from '../services/binding'
import { mountModalHost, type ShadowHostHandle } from '../ui/shadow/shadow-host'
import { createModelStore, type ModelStore } from '../ui/shadow/model-store'
import { ShadowNotificationApp, type NotificationState } from '../ui/notification/ShadowNotificationApp'

// Marker for the in-realm notification shadow host.
const NOTIFICATION_HOST_ATTR = 'data-asbplayer-notification-host'

// Over-video notification/alert dialogs, rendered in the content-script realm via
// a fullscreen-aware modal shadow host (the MUI Dialog brings its own backdrop /
// Escape / click-outside). The model flows through a store; `close` is a callback.
export default class NotificationController {
  public onClose?: () => void

  private readonly _context: Binding
  private _store?: ModelStore<NotificationState>
  private _shadowHandle?: ShadowHostHandle
  private _showing = false

  constructor(context: Binding) {
    this._context = context
  }

  get showing() {
    return this._showing
  }

  hide() {
    this._resetState()
    this._showing = false
  }

  async show(titleLocKey: string, messageLocKey: string) {
    this._ensureMounted()

    if (document.fullscreenElement) {
      document.exitFullscreen()
    }

    const { themeType, language } = await this._context.settings.get(['themeType', 'language'])
    this._store!.set({ themeType, language, titleLocKey, messageLocKey, newVersion: undefined })
    this._showing = true
    this._context.pause()
  }

  async updateAlert(newVersion: string) {
    this._ensureMounted()
    const { themeType, language } = await this._context.settings.get(['themeType', 'language'])
    this._store!.set({ themeType, language, titleLocKey: '', messageLocKey: '', newVersion })
  }

  // Reset the dialog/snackbar to hidden while keeping the host mounted.
  private _resetState() {
    const prev = this._store?.getSnapshot()
    if (this._store && prev) {
      this._store.set({ ...prev, titleLocKey: '', messageLocKey: '', newVersion: undefined })
    }
  }

  // The `close` handler the in-realm app calls: undo the force-hides put up while
  // the dialog showed, restore the controls, hide the dialog, and fire onClose.
  private _onClose = () => {
    this._context.subtitleController.forceHideSubtitles = false
    this._context.mobileVideoOverlayController.forceHide = false
    this._context.controlsController.show()
    this._resetState()
    this._showing = false
    this.onClose?.()
  }

  private _ensureMounted() {
    if (this._shadowHandle) {
      return
    }
    if (!this._store) {
      this._store = createModelStore<NotificationState>({
        themeType: 'dark',
        language: 'en',
        titleLocKey: '',
        messageLocKey: '',
        newVersion: undefined,
      })
    }
    const store = this._store
    this._shadowHandle = mountModalHost({
      hostAttribute: NOTIFICATION_HOST_ATTR,
      render: ({ shadowRoot, portalContainer }) =>
        createElement(ShadowNotificationApp, { store, shadowRoot, portalContainer, onClose: this._onClose }),
    })
  }

  unbind() {
    this._shadowHandle?.unmount()
    this._shadowHandle = undefined
    this._store = undefined
    this._showing = false
  }
}
