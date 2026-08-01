import type { Browser } from 'wxt/browser'
import { ORPCError } from '@orpc/contract'
import type {
  Command,
  FlicktionaryDeclarationPreviewMessage,
  FlicktionaryDeclarationPreviewResponse,
  Message,
} from '@asbplayer-fork/common'
import { msg } from '@lingui/core/macro'
import { getFullAccountFlicktionaryAuth } from '../../services/flicktionary/auth-storage'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import {
  resolveExistingFlicktionarySession,
  resolveOrCreateFlicktionarySession,
} from '../../services/flicktionary/session-resolver'
import { removeFlicktionarySession } from '../../services/flicktionary/youtube-session-cache'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'
import { activateBackgroundLocale } from '../../services/activate-background-locale'
import { i18n } from '../../ui/lingui'

const isNotFound = (result: PromiseSettledResult<unknown>): boolean =>
  result.status === 'rejected' && result.reason instanceof ORPCError && result.reason.code === 'NOT_FOUND'

// The declaration sheet's data lane: resolve the video's session (cache →
// lookup probe → find-or-create; the tap is an explicit user act, exactly like
// a collect press) and fetch both preview counts in one round trip. The lanes
// degrade independently — a failed checkpoint preview only loses the count
// (collect still works blind), a failed mark-known preview drops the optional
// sweep step for this run.
export default class DeclarationPreviewHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'flicktionary-declaration-preview'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: FlicktionaryDeclarationPreviewResponse) => void
  ) {
    const message = command.message as FlicktionaryDeclarationPreviewMessage

    void (async () => {
      try {
        const auth = await getFullAccountFlicktionaryAuth()
        if (!auth) {
          if (message.readOnly) {
            // Passive probe: no chip will render this, keep it silent.
            sendResponse({ success: false })
            return
          }
          await activateBackgroundLocale()
          sendResponse({ success: false, error: i18n._(msg`Sign in to Flicktionary to collect reviews.`) })
          return
        }
        const resolve = async () => {
          if (!message.readOnly) {
            return await resolveOrCreateFlicktionarySession(message.flicktionaryVideo)
          }
          return await resolveExistingFlicktionarySession(message.flicktionaryVideo)
        }
        let session = await resolve()
        if (!session) {
          sendResponse({ success: false, code: 'NO_SESSION' })
          return
        }
        let previews = await this._fetchPreviews(session.sessionId, message.segmentIndex)
        // Stale cache (session deleted in the web app): evict, re-resolve once
        // (the lookup now sees the deletion), and re-preview against the fresh
        // session.
        if (isNotFound(previews.checkpoint) || isNotFound(previews.markKnown)) {
          await removeFlicktionarySession(message.flicktionaryVideo.source, message.flicktionaryVideo.contentHash)
          session = await resolve()
          if (!session) {
            sendResponse({ success: false, code: 'NO_SESSION' })
            return
          }
          previews = await this._fetchPreviews(session.sessionId, message.segmentIndex)
        }
        const checkpoint = previews.checkpoint.status === 'fulfilled' ? previews.checkpoint.value.data : undefined
        const markKnown = previews.markKnown.status === 'fulfilled' ? previews.markKnown.value.data : undefined
        sendResponse({
          success: true,
          sessionId: session.sessionId,
          targetLanguage: session.targetLanguage,
          checkpointSupported: checkpoint?.supported,
          pendingCount: checkpoint?.pendingCount,
          markKnownStatus: markKnown?.status ?? 'failed',
          markableLemmaCount: markKnown?.markableLemmaCount ?? 0,
        })
      } catch (error) {
        const {
          code,
          message: errorMessage,
          targetLanguage,
        } = extractFlicktionaryApiError(error, 'flicktionary-declaration-preview failed')
        sendResponse({ success: false, code, error: errorMessage, targetLanguage })
      }
    })()

    return true
  }

  private async _fetchPreviews(sessionId: string, toSegmentIndex: number) {
    const client = getFlicktionaryApiClient()
    const [checkpoint, markKnown] = await Promise.allSettled([
      client.studySessions.getCheckpointPreview({ sessionId, toSegmentIndex }),
      client.studySessions.getMarkKnownPreview({ sessionId, toSegmentIndex }),
    ])
    return { checkpoint, markKnown }
  }
}
