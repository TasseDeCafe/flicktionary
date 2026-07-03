import { Command, Message } from '@asbplayer-fork/common'

export interface CommandHandler {
  sender: string | string[]
  command: string | null
  handle: (
    command: Command<Message>,
    sender: Browser.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => boolean | undefined | Promise<unknown>
}
