import type { Browser } from 'wxt/browser'
import type {
  Command,
  FlicktionaryCheckpointAvailabilityMessage,
  FlicktionaryCheckpointAvailabilityResponse,
  Message,
} from '@asbplayer-fork/common'
import { lookupFlicktionarySession } from '../../services/flicktionary/youtube-session-cache'

// Cache-only probe (no network) behind the overlay's checkpoint-button
// visibility rule: a video whose CACHED session has an unsupported target
// language hides the button pre-press. A cold cache answers null — the
// language is unknown until first registration, so the button shows and the
// press itself reports the outcome.
export default class CheckpointAvailabilityHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'flicktionary-checkpoint-availability'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: FlicktionaryCheckpointAvailabilityResponse) => void
  ) {
    const message = command.message as FlicktionaryCheckpointAvailabilityMessage

    void (async () => {
      const cached = await lookupFlicktionarySession(message.source, message.contentHash)
      sendResponse({ cachedTargetLanguage: cached?.targetLanguage ?? null })
    })()

    return true
  }
}
