import type { Browser } from 'wxt/browser'
import type {
  Command,
  FlicktionaryUndoCheckpointMessage,
  FlicktionaryUndoCheckpointResponse,
  Message,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Batch-undo of the overlay's last checkpoint press. `undone: false` is the
// server's stale-safe no-op (not the latest live checkpoint anymore) — the
// chip reports it as "may have changed since", never as a crash.
export default class UndoCheckpointHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'flicktionary-undo-checkpoint'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: FlicktionaryUndoCheckpointResponse) => void
  ) {
    const message = command.message as FlicktionaryUndoCheckpointMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        const { data } = await client.studySessions.undoCheckpoint({
          sessionId: message.sessionId,
          checkpointId: message.checkpointId,
        })
        sendResponse({ success: true, undone: data.undone })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'flicktionary-undo-checkpoint failed')
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
