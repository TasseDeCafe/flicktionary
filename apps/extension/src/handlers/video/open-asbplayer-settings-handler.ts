import { Command, Message } from '@asbplayer-fork/common'

export default class OpenAsbplayerSettingsHandler {
  get sender() {
    return ['asbplayer-video', 'asbplayer-video-tab']
  }

  get command() {
    return 'open-asbplayer-settings'
  }

  async handle(command: Command<Message>, sender: Browser.runtime.MessageSender) {
    browser.runtime.openOptionsPage()
  }
}
