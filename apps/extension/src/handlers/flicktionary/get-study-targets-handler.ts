import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  GetFlicktionaryStudyTargetsMessage,
  GetFlicktionaryStudyTargetsResponse,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Reads a materialized term's live facets so the saved popover can render the
// citation skill cards post-enrich. Wraps chunks.getStudyTargets.
export default class GetFlicktionaryStudyTargetsHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'get-flicktionary-study-targets'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: GetFlicktionaryStudyTargetsResponse) => void
  ) {
    const message = command.message as GetFlicktionaryStudyTargetsMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        const { data } = await client.chunks.getStudyTargets({ chunkId: message.chunkId })
        sendResponse({
          success: true,
          facets: data.facets.map((f) => ({ skill: f.skill, targetForm: f.targetForm, enabled: f.enabled })),
        })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'get-flicktionary-study-targets failed')
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
