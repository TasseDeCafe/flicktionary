import { createElement } from 'react'
import {
  CaptureVisibleTabMessage,
  ExtensionToVideoCommand,
  ForegroundToExtensionCommand,
  Message,
  OpenAsbplayerSettingsMessage,
  SubtitleFile,
  TabToExtensionCommand,
  ToggleVideoSelectMessage,
  VideoSelectModeCancelMessage,
  VideoSelectModeConfirmMessage,
} from '@asbplayer-fork/common'
import { SettingsProvider } from '@asbplayer-fork/common/settings'
import Binding from '../services/binding'
import { ExtensionSettingsStorage } from '../services/extension-settings-storage'
import { setupLingui } from '../ui/lingui'
import { mountModalHost, type ShadowHostHandle } from '../ui/shadow/shadow-host'
import { ShadowVideoSelectApp, type VideoSelectCommands } from '../ui/video-select/shadow-video-select-app'
import {
  createVideoSelectStore,
  type VideoElement,
  type VideoSelectState,
  type VideoSelectStore,
} from '../ui/video-select/video-select-store'

// The in-realm model sink (the store's updateState action); this minimal shape
// is what the rest of the controller drives.
interface VideoSelectClient {
  updateState(state: Partial<VideoSelectState>): void
}

// Marker for the in-realm video-select shadow host.
const VIDEO_SELECT_HOST_ATTR = 'data-asbplayer-video-select-host'

export default class VideoSelectController {
  private readonly _bindings: Binding[]
  private readonly _settings: SettingsProvider = new SettingsProvider(new ExtensionSettingsStorage())
  private _subtitleFiles?: SubtitleFile[]

  // The video-select dialog renders in the content-script realm via a
  // fullscreen-aware modal shadow host. The model flows through `_store`
  // (partial pushes via the store's updateState action); UI commands route
  // through `_handleUiCommand`.
  private _store?: VideoSelectStore
  private _shadowHandle?: ShadowHostHandle
  private _shadowOpen = false

  private messageListener?: (
    request: ExtensionToVideoCommand<Message>,
    sender: Browser.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => void

  constructor(bindings: Binding[]) {
    this._bindings = bindings
  }

  bind() {
    this.messageListener = (
      request: ExtensionToVideoCommand<Message>,
      sender: Browser.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => {
      if (request.sender !== 'asbplayer-extension-to-video') {
        return
      }

      switch (request.message.command) {
        case 'toggle-video-select': {
          const message = request.message as ToggleVideoSelectMessage
          this._trigger(false, message.fromAsbplayerId, request.src, message.subtitleFiles)
          break
        }
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
    this._shadowHandle?.unmount()
    this._shadowHandle = undefined
    this._store = undefined
    this._shadowOpen = false

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
    if (!this._store) {
      this._store = createVideoSelectStore()
    }
    if (this._shadowHandle) {
      return
    }
    const language = await this._settings.getSingle('language')
    setupLingui(language)
    const store = this._store
    const commands = this._shadowCommands()
    this._shadowHandle = mountModalHost({
      hostAttribute: VIDEO_SELECT_HOST_ATTR,
      // Radix/Tailwind surface: adopt the shared overlay sheet (tokens +
      // utilities) instead of emotion.
      adoptTailwind: true,
      render: ({ shadowRoot, portalContainer }) =>
        createElement(ShadowVideoSelectApp, { store, shadowRoot, portalContainer, language, commands }),
    })
  }

  private _isHidden(): boolean {
    return !this._shadowOpen
  }

  // Drive the dialog closed (model open:false).
  private async _closeUi() {
    this._store?.getState().updateState({ open: false })
    this._shadowOpen = false
  }

  private async _prepareAndShowFrame(): Promise<VideoSelectClient> {
    await this._ensureShadowMounted()
    this._shadowOpen = true
    return this._store!.getState()
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
