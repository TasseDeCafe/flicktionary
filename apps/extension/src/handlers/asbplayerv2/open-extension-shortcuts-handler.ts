import { Command, Message } from '@asbplayer-fork/common'

export default class OpenExtensionShortcutsHandler {
  get sender() {
    return 'asbplayerv2'
  }

  get command() {
    return 'open-extension-shortcuts'
  }

  handle(command: Command<Message>, sender: Browser.runtime.MessageSender) {
    browser.tabs.create({ active: true, url: 'chrome://extensions/shortcuts' })
    return false
  }
}
