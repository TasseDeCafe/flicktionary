import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  SetFlicktionaryFacetEnabledMessage,
  SetFlicktionaryFacetEnabledResponse,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Toggles one live facet on a materialized term — the same chunks.setFacetEnabled
// write the web focus view / saved sheet use. The backend floor guard (kept
// terms keep ≥1 enabled facet) surfaces as a CONFLICT error; the saved popover's
// highlight is a pending triage card (not kept), so it shouldn't trip it.
export default class SetFlicktionaryFacetEnabledHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'set-flicktionary-facet-enabled'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: SetFlicktionaryFacetEnabledResponse) => void
  ) {
    const message = command.message as SetFlicktionaryFacetEnabledMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        await client.chunks.setFacetEnabled({
          chunkId: message.chunkId,
          skill: message.skill,
          targetForm: message.targetForm,
          enabled: message.enabled,
        })
        sendResponse({ success: true })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'set-flicktionary-facet-enabled failed')
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
