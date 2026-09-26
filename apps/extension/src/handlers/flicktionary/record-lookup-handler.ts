import type { Browser } from 'wxt/browser'
import type { Command, Message, FlicktionaryRecordLookupMessage } from '@asbplayer-fork/common'
import { getFlicktionaryAuth } from '../../services/flicktionary/auth-storage'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'

// Records an explicit subtitle lookup (a pinned hover gloss) as a new-term
// demand signal via `glosses.recordLookup`. Fire-and-forget: it never mints a
// guest session (the gloss that preceded it already did, if one was needed)
// and swallows failures — a lost signal must never surface in the video.
export default class FlicktionaryRecordLookupHandler {
  get sender() {
    return ['asbplayer-video-tab', 'asbplayerv2']
  }

  get command() {
    return 'flicktionary-record-lookup'
  }

  handle(command: Command<Message>, _sender: Browser.runtime.MessageSender, sendResponse: () => void) {
    const message = command.message as FlicktionaryRecordLookupMessage

    void (async () => {
      try {
        if (await getFlicktionaryAuth()) {
          await getFlicktionaryApiClient().glosses.recordLookup({
            selectionText: message.selectionText,
            targetLanguage: message.targetLanguage,
          })
        }
      } catch (error) {
        console.warn('Failed to record a Flicktionary lookup', error)
      }
      sendResponse()
    })()

    return true
  }
}
