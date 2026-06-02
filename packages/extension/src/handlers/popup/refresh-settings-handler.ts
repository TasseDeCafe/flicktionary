import {
  Command,
  ExtensionToAsbPlayerCommand,
  ExtensionToVideoCommand,
  Message,
  SettingsUpdatedMessage,
} from '@asbplayer-fork/common'
import TabRegistry from '../../services/tab-registry'
import { SettingsProvider } from '@asbplayer-fork/common/settings'

export default class RefreshSettingsHandler {
  private readonly _tabRegistry: TabRegistry
  private readonly _settingsProvider: SettingsProvider
  constructor(tabRegistry: TabRegistry, settingsProvider: SettingsProvider) {
    this._tabRegistry = tabRegistry
    this._settingsProvider = settingsProvider
  }

  get sender() {
    return ['asbplayer-popup', 'asbplayer-settings', 'asbplayer-video', 'asbplayer-video-tab']
  }

  get command() {
    return 'settings-updated'
  }

  handle(command: Command<Message>, sender: Browser.runtime.MessageSender) {
    this._tabRegistry.publishCommandToVideoElements((videoElement) => {
      const settingsUpdatedCommand: ExtensionToVideoCommand<SettingsUpdatedMessage> = {
        sender: 'asbplayer-extension-to-video',
        message: {
          command: 'settings-updated',
        },
        src: videoElement.src,
      }
      return settingsUpdatedCommand
    })
    this._tabRegistry.publishCommandToAsbplayers({
      commandFactory: () => {
        const settingsUpdatedCommand: ExtensionToAsbPlayerCommand<SettingsUpdatedMessage> = {
          sender: 'asbplayer-extension-to-player',
          message: {
            command: 'settings-updated',
          },
        }
        return settingsUpdatedCommand
      },
    })
    browser.tabs.query({ url: `${browser.runtime.getURL('/options.html')}` }).then((tabs) => {
      for (const t of tabs) {
        if (t.id !== undefined) {
          browser.tabs.sendMessage(t.id, {
            message: {
              command: 'settings-updated',
            },
          })
        }
      }
    })
    return false
  }
}
