import { Command, Message } from '@asbplayer-fork/common'

export default class VideoOverlayForwarderHandler {
  get sender() {
    return 'asbplayer-video-overlay-to-video'
  }

  get command() {
    return null
  }

  handle(command: Command<Message>, sender: Browser.runtime.MessageSender, sendResponse: (response?: any) => void) {
    if (sender.tab?.id === undefined) {
      return
    }

    browser.tabs.sendMessage(sender.tab.id, command)
    return false
  }
}
