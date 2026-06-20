import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  UpdateFlicktionaryStudyIntentMessage,
  UpdateFlicktionaryStudyIntentResponse,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Edits the stored study_intent of a not-yet-enriched saved highlight — the same
// highlights.updateStudyIntent write the web reader's saved gloss sheet uses. A
// 409 CONFLICT means the enrich job already applied the intent; we surface it as
// `applied: true` so the saved popover switches to live-facet editing.
export default class UpdateFlicktionaryStudyIntentHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'update-flicktionary-study-intent'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: UpdateFlicktionaryStudyIntentResponse) => void
  ) {
    const message = command.message as UpdateFlicktionaryStudyIntentMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        await client.highlights.updateStudyIntent({
          sessionId: message.sessionId,
          highlightId: message.highlightId,
          studyIntent: message.studyIntent
            ? { skills: [...message.studyIntent.skills], formScope: message.studyIntent.formScope }
            : null,
        })
        sendResponse({ success: true })
      } catch (error) {
        if ((error as { code?: string } | undefined)?.code === 'CONFLICT') {
          sendResponse({ success: false, applied: true })
          return
        }
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'update-flicktionary-study-intent failed')
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
