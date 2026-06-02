import { Command, Message } from '@asbplayer-fork/common'

export default class CurrentTabHandler {
  get sender() {
    return 'asbplayer-video-overlay'
  }

  get command() {
    return 'current-tab'
  }

  handle(command: Command<Message>, sender: Browser.runtime.MessageSender, sendResponse: (response?: any) => void) {
    sendResponse(sender.tab?.id)
    return false
  }
}
