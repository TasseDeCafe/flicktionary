import type { Browser } from 'wxt/browser'
import type {
  Command,
  FlicktionaryUndoKnownAssertionsMessage,
  FlicktionaryUndoKnownAssertionsResponse,
  Message,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// The declaration toast's Undo, known-assertions part: revert the words a
// checkpoint's never-practiced step marked as known. Assertions rated again
// since are skipped server-side — still a success.
export default class UndoKnownAssertionsHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'flicktionary-undo-known-assertions'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: FlicktionaryUndoKnownAssertionsResponse) => void
  ) {
    const message = command.message as FlicktionaryUndoKnownAssertionsMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        await client.studySessions.undoKnownAssertions({
          sessionId: message.sessionId,
          checkpointId: message.checkpointId,
        })
        sendResponse({ success: true })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(
          error,
          'flicktionary-undo-known-assertions failed'
        )
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
