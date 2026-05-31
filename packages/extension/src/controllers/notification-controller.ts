import { createElement } from 'react'
import Binding from '../services/binding'
import UiFrame from '../services/ui-frame'
import FrameBridgeClient from '../services/frame-bridge-client'
import { SHADOW_NOTIFICATION_ENABLED } from '../services/flicktionary/shadow-ui-flags'
import { mountModalHost, type ShadowHostHandle } from '../ui/shadow/shadow-host'
import { createModelStore, type ModelStore } from '../ui/shadow/model-store'
import { ShadowNotificationApp, type NotificationState } from '../ui/notification/ShadowNotificationApp'

// Marker for the in-realm notification shadow host (flag-ON path).
const NOTIFICATION_HOST_ATTR = 'data-asbplayer-notification-host'

export default class NotificationController {
  public onClose?: () => void

  private readonly _context: Binding
  private readonly _frame: UiFrame
  private _client?: FrameBridgeClient

  // --- Shadow DOM (flag-ON) transport ---------------------------------------
  // When SHADOW_NOTIFICATION_ENABLED is on, the notification/alert dialogs render
  // in the content-script realm via a fullscreen-aware modal shadow host (the MUI
  // Dialog brings its own backdrop/Escape/click-outside). The model flows through
  // `_store` and `close` is a direct callback; the iframe path below is unchanged.
  private readonly _useShadow = SHADOW_NOTIFICATION_ENABLED
  private _store?: ModelStore<NotificationState>
  private _shadowHandle?: ShadowHostHandle
  private _showing = false

  constructor(context: Binding) {
    this._context = context
    this._frame = new UiFrame(
      async (lang) =>
        `<!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="utf-8" />
                        <meta name="viewport" content="width=device-width, initial-scale=1" />
                        <title>asbplayer</title>
                        <style>
                        @import url(${browser.runtime.getURL('/fonts/fonts.css')});
                        </style>
                    </head>
                    <body>
                        <div id="root" style="width:100%;height:100vh;"></div>
                        <script type="application/json" id="loc">${JSON.stringify({ lang })}</script>
                        <script type="module" src="${browser.runtime.getURL('/notification-ui.js')}"></script>
                    </body>
                </html>`
    )
  }

  get showing() {
    if (this._useShadow) {
      return this._showing
    }
    return !this._frame.hidden
  }

  hide() {
    if (this._useShadow) {
      this._resetShadowState()
      this._showing = false
      return
    }
    this._frame.hide()
  }

  async show(titleLocKey: string, messageLocKey: string) {
    if (this._useShadow) {
      this._ensureMounted()

      if (document.fullscreenElement) {
        document.exitFullscreen()
      }

      const { themeType, language } = await this._context.settings.get(['themeType', 'language'])
      this._store!.set({ themeType, language, titleLocKey, messageLocKey, newVersion: undefined })
      this._showing = true
      this._context.pause()
      return
    }

    await this._prepareAndShowFrame('asbplayer-ui-frame')

    if (document.fullscreenElement) {
      document.exitFullscreen()
    }

    this._client!.updateState({
      themeType: await this._context.settings.getSingle('themeType'),
      titleLocKey,
      messageLocKey,
      alertLocKey: '',
    })
    this._context.pause()
  }

  async updateAlert(newVersion: string) {
    if (this._useShadow) {
      this._ensureMounted()
      const { themeType, language } = await this._context.settings.get(['themeType', 'language'])
      this._store!.set({ themeType, language, titleLocKey: '', messageLocKey: '', newVersion })
      return
    }

    await this._prepareAndShowFrame('asbplayer-alert')
    this._client!.updateState({
      themeType: await this._context.settings.getSingle('themeType'),
      titleLocKey: '',
      messageLocKey: '',
      newVersion,
    })
  }

  // Reset the dialog/snackbar to hidden while keeping the host mounted.
  private _resetShadowState() {
    const prev = this._store?.getSnapshot()
    if (this._store && prev) {
      this._store.set({ ...prev, titleLocKey: '', messageLocKey: '', newVersion: undefined })
    }
  }

  // The `close` handler that the in-realm app calls (formerly the bridge 'close'
  // message): undo the force-hides put up while the dialog showed, restore the
  // controls, hide the dialog, and fire onClose. Mirrors _prepareAndShowFrame.
  private _onShadowClose = () => {
    this._context.subtitleController.forceHideSubtitles = false
    this._context.mobileVideoOverlayController.forceHide = false
    this._context.controlsController.show()
    this._resetShadowState()
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
        createElement(ShadowNotificationApp, { store, shadowRoot, portalContainer, onClose: this._onShadowClose }),
    })
  }

  private async _prepareAndShowFrame(className: string) {
    this._frame.language = await this._context.settings.getSingle('language')
    const isNewClient = await this._frame.bind()
    this._frame.frame!.className = className
    this._client = await this._frame.client()

    if (isNewClient) {
      this._client.onMessage((message) => {
        if (message.command === 'close') {
          this._context.subtitleController.forceHideSubtitles = false
          this._context.mobileVideoOverlayController.forceHide = false
          this._context.controlsController.show()
          this._frame.hide()
          this.onClose?.()
        }
      })
    }

    this._frame.show()
  }

  unbind() {
    if (this._useShadow) {
      this._shadowHandle?.unmount()
      this._shadowHandle = undefined
      this._store = undefined
      this._showing = false
      return
    }
    this._frame?.unbind()
  }
}
