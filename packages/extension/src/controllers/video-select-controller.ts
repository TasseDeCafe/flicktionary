import { createElement } from 'react'
import {
  CaptureVisibleTabMessage,
  ForegroundToExtensionCommand,
  Message,
  OpenAsbplayerSettingsMessage,
  SubtitleFile,
  TabToExtensionCommand,
  VideoSelectModeCancelMessage,
  VideoSelectModeConfirmMessage,
} from '@asbplayer-fork/common'
import { SettingsProvider } from '@asbplayer-fork/common/settings'
import { VideoElement } from '../ui/components/VideoSelectUi'
import Binding from '../services/binding'
import UiFrame from '../services/ui-frame'
import { ExtensionSettingsStorage } from '../services/extension-settings-storage'
import { SHADOW_VIDEO_SELECT_ENABLED } from '../services/flicktionary/shadow-ui-flags'
import { setupLingui } from '../ui/lingui'
import { mountModalHost, type ShadowHostHandle } from '../ui/shadow/shadow-host'
import { createUpdateChannel, type UpdateChannel } from '../ui/shadow/model-store'
import {
  ShadowVideoSelectApp,
  type VideoSelectCommands,
  type VideoSelectState,
} from '../ui/video-select/ShadowVideoSelectApp'

// Both FrameBridgeClient and the in-realm channel expose updateState, so the
// controller can drive either through this minimal shape.
interface VideoSelectClient {
  updateState(state: Partial<VideoSelectState>): void
}

// Marker for the in-realm video-select shadow host (flag-ON path).
const VIDEO_SELECT_HOST_ATTR = 'data-asbplayer-video-select-host'

export default class VideoSelectController {
  private readonly _bindings: Binding[]
  private readonly _frame: UiFrame
  private readonly _settings: SettingsProvider = new SettingsProvider(new ExtensionSettingsStorage())
  private _subtitleFiles?: SubtitleFile[]

  // --- Shadow DOM (flag-ON) transport ---------------------------------------
  // When SHADOW_VIDEO_SELECT_ENABLED is on, the video-select dialog renders in
  // the content-script realm via a fullscreen-aware modal shadow host. The model
  // flows through `_channel` (mirroring updateState over the FrameBridge) and the
  // UI commands route through `_handleUiCommand`. The iframe path is unchanged.
  private readonly _useShadow = SHADOW_VIDEO_SELECT_ENABLED
  private _channel?: UpdateChannel<VideoSelectState>
  private _shadowHandle?: ShadowHostHandle
  private _shadowOpen = false

  private messageListener?: (
    request: any,
    sender: Browser.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => void

  constructor(bindings: Binding[]) {
    this._bindings = bindings
    this._frame = new UiFrame(
      async (lang) => `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="utf-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1" />
                    <title>asbplayer - Video Select</title>
                    <style>
                        @import url(${browser.runtime.getURL('/fonts/fonts.css')});
                    </style>
                </head>
                <body>
                    <div id="root" style="width:100%;height:100vh;"></div>
                    <script type="application/json" id="loc">${JSON.stringify({ lang })}</script>
                    <script type="module" src="${browser.runtime.getURL('/video-select-ui.js')}"></script>
                </body>
            </html>`
    )
  }

  bind() {
    this.messageListener = (
      request: any,
      sender: Browser.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ) => {
      if (request.sender !== 'asbplayer-extension-to-video') {
        return
      }

      switch (request.message.command) {
        case 'toggle-video-select':
          this._trigger(false, request.message.fromAsbplayerId, request.src, request.message.subtitleFiles)
          break
        case 'copy-subtitle':
        case 'toggle-recording':
        case 'take-screenshot':
          if (this._bindings.find((b) => b.synced) === undefined) {
            this._trigger(true)
          }
          break
        case 'subtitles':
          this._hideUi()
          break
        default:
        // ignore
      }
    }

    browser.runtime.onMessage.addListener(this.messageListener)
  }

  unbind() {
    this._frame.unbind()

    if (this._useShadow) {
      this._shadowHandle?.unmount()
      this._shadowHandle = undefined
      this._channel = undefined
      this._shadowOpen = false
    }

    if (this.messageListener) {
      browser.runtime.onMessage.removeListener(this.messageListener)
      this.messageListener = undefined
    }
  }

  private async _trigger(
    openedFromMiningCommand: boolean,
    fromAsbplayerId?: string,
    targetSrc?: string,
    subtitleFiles?: SubtitleFile[]
  ) {
    if (targetSrc !== undefined) {
      var binding = this._bindings.find((b) => b.video.src === targetSrc)

      if (binding !== undefined && binding.subscribed) {
        if (subtitleFiles !== undefined) {
          binding.loadSubtitles(await this._filesForSubtitleFiles(subtitleFiles), false, fromAsbplayerId)
        } else {
          binding.showVideoDataDialog(openedFromMiningCommand, fromAsbplayerId)
        }
      }
    } else if (this._bindings.length === 1) {
      // Special case - skip video select dialog since there is only one element
      const binding = this._bindings[0]

      if (binding.subscribed) {
        if (subtitleFiles !== undefined) {
          binding.loadSubtitles(await this._filesForSubtitleFiles(subtitleFiles), false)
        } else {
          binding.showVideoDataDialog(openedFromMiningCommand)
        }
      }
    } else if (this._bindings.length > 1) {
      // Toggle on
      this._showUi(openedFromMiningCommand)
      this._subtitleFiles = subtitleFiles
    }
  }

  private async _showUi(openedFromMiningCommand: boolean) {
    const captureVisibleTabCommand: ForegroundToExtensionCommand<CaptureVisibleTabMessage> = {
      sender: 'asbplayer-foreground',
      message: { command: 'capture-visible-tab' },
    }

    const tabImageDataUrl = (await browser.runtime.sendMessage(captureVisibleTabCommand)) as string
    const videoElementPromises: Promise<VideoElement>[] = this._bindings.map(async (b) => {
      return {
        src: b.video.src,
        imageDataUrl: await b.cropAndResize(tabImageDataUrl),
      }
    })

    const videoElements: VideoElement[] = []

    for (const p of videoElementPromises) {
      videoElements.push(await p)
    }

    const client = await this._prepareAndShowFrame()
    const themeType = await this._settings.getSingle('themeType')
    client.updateState({ open: true, themeType, videoElements, openedFromMiningCommand })
  }

  // Handle a command from the UI — shared by the iframe onMessage path and the
  // in-realm command callbacks so both transports run identical logic.
  private async _handleUiCommand(message: Message) {
    if (message.command === 'confirm') {
      await this._closeUi()
      const binding = this._bindings.find(
        (b) => b.video.src === (message as VideoSelectModeConfirmMessage).selectedVideoElementSrc
      )
      if (binding !== undefined) {
        if (this._subtitleFiles === undefined) {
          binding.showVideoDataDialog(false)
        } else {
          binding.loadSubtitles(await this._filesForSubtitleFiles(this._subtitleFiles), false)
          this._subtitleFiles = undefined
        }
      }
    } else if (message.command === 'openSettings') {
      const openSettingsCommand: TabToExtensionCommand<OpenAsbplayerSettingsMessage> = {
        sender: 'asbplayer-video-tab',
        message: {
          command: 'open-asbplayer-settings',
        },
      }
      browser.runtime.sendMessage(openSettingsCommand)
    } else if (message.command === 'cancel') {
      await this._closeUi()
      this._subtitleFiles = undefined
    }
  }

  private _shadowCommands(): VideoSelectCommands {
    return {
      onConfirm: (selectedVideoElementSrc) =>
        void this._handleUiCommand({ command: 'confirm', selectedVideoElementSrc } as VideoSelectModeConfirmMessage),
      onOpenSettings: () => void this._handleUiCommand({ command: 'openSettings' }),
      onCancel: () => void this._handleUiCommand({ command: 'cancel' } as VideoSelectModeCancelMessage),
    }
  }

  private async _ensureShadowMounted() {
    if (!this._channel) {
      this._channel = createUpdateChannel<VideoSelectState>()
    }
    if (this._shadowHandle) {
      return
    }
    const language = await this._settings.getSingle('language')
    setupLingui(language)
    const channel = this._channel
    const commands = this._shadowCommands()
    this._shadowHandle = mountModalHost({
      hostAttribute: VIDEO_SELECT_HOST_ATTR,
      render: ({ shadowRoot, portalContainer }) =>
        createElement(ShadowVideoSelectApp, { channel, shadowRoot, portalContainer, language, commands }),
    })
  }

  private _isHidden(): boolean {
    return this._useShadow ? !this._shadowOpen : this._frame.hidden
  }

  // Drive the dialog closed (model open:false + hide the host/frame).
  private async _closeUi() {
    if (this._useShadow) {
      this._channel?.updateState({ open: false })
      this._shadowOpen = false
      return
    }
    const client = await this._frame.client()
    client.updateState({ open: false })
    this._frame.hide()
  }

  private async _prepareAndShowFrame(): Promise<VideoSelectClient> {
    if (this._useShadow) {
      await this._ensureShadowMounted()
      this._shadowOpen = true
      return this._channel!
    }

    this._frame.language = await this._settings.getSingle('language')
    const isNewClient = await this._frame.bind()
    const client = await this._frame.client()

    if (isNewClient) {
      client.onMessage(async (message) => {
        await this._handleUiCommand(message)
      })
    }

    this._frame.show()
    return client
  }

  private async _hideUi() {
    if (this._isHidden()) {
      return
    }

    await this._closeUi()
  }

  private async _filesForSubtitleFiles(subtitleFiles: SubtitleFile[]) {
    const filePromises = subtitleFiles.map(
      async (f) => new File([await (await fetch('data:text/plain;base64,' + f.base64)).blob()], f.name)
    )
    return await Promise.all(filePromises)
  }
}
