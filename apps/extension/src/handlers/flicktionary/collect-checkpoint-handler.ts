import type { Browser } from 'wxt/browser'
import { ORPCError } from '@orpc/contract'
import type {
  Command,
  FlicktionaryCollectCheckpointMessage,
  FlicktionaryCollectCheckpointResponse,
  Message,
} from '@asbplayer-fork/common'
import { msg } from '@lingui/core/macro'
import { getFlicktionaryAuth } from '../../services/flicktionary/auth-storage'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { resolveOrCreateFlicktionarySession } from '../../services/flicktionary/session-resolver'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'
import { activateBackgroundLocale } from '../../services/activate-background-locale'
import { i18n } from '../../ui/lingui'

// The overlay's checkpoint press (docs/SRS.md §6b): resolve the video's
// session (cache → lookup probe → find-or-create; the press is an explicit
// user act, so cold-start creation is allowed exactly like a first save) and
// collect implicit recognition credits up to the content-computed segment
// index. The extension sends no previewedSpans — its gloss popover has no
// stateless preview lane tracked per span; saved highlights are suppressed
// server-side from the DB.
export default class CollectCheckpointHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'flicktionary-collect-checkpoint'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: FlicktionaryCollectCheckpointResponse) => void
  ) {
    const message = command.message as FlicktionaryCollectCheckpointMessage

    void (async () => {
      try {
        await activateBackgroundLocale()
        const auth = await getFlicktionaryAuth()
        if (!auth) {
          sendResponse({ success: false, error: i18n._(msg`Sign in to Flicktionary to collect reviews.`) })
          return
        }
        const session = await resolveOrCreateFlicktionarySession(message.flicktionaryVideo)
        const client = getFlicktionaryApiClient()
        const { data } = await client.studySessions.collectCheckpoint({
          sessionId: session.sessionId,
          toSegmentIndex: message.segmentIndex,
          previewedSpans: [],
        })
        sendResponse({
          success: true,
          sessionId: session.sessionId,
          targetLanguage: session.targetLanguage,
          checkpointId: data.checkpointId,
          creditedCount: data.creditedCount,
        })
      } catch (error) {
        // The 409 carries no domain code in its payload, so the generic
        // extractor can't see it — the declaration sheet needs the code to
        // offer its inline re-snapshot retry.
        if (error instanceof ORPCError && error.code === 'CONFLICT') {
          sendResponse({ success: false, code: 'CONFLICT' })
          return
        }
        const {
          code,
          message: errorMessage,
          targetLanguage,
        } = extractFlicktionaryApiError(error, 'flicktionary-collect-checkpoint failed')
        sendResponse({ success: false, code, error: errorMessage, targetLanguage })
      }
    })()

    return true
  }
}
