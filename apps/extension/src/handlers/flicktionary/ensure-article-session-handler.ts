import type { Browser } from 'wxt/browser'
import type {
  Command,
  EnsureArticleSessionMessage,
  EnsureArticleSessionResponse,
  Message,
  SavedHighlightDto,
} from '@asbplayer-fork/common'
import { getFlicktionaryAuth } from '../../services/flicktionary/auth-storage'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import {
  lookupArticleSession,
  storeArticleSession,
  type ArticleSessionCacheEntry,
} from '../../services/flicktionary/article-session-cache'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'
import { startBadgeBusy, finishBadgeBusy } from '../../services/flicktionary/article-badge'
import { activateBackgroundLocale } from '../../services/activate-background-locale'

// Find-or-create the study session for an extracted article (sender
// 'flicktionary-extension-highlight'). Idempotent server-side on the text hash;
// this handler additionally caches the result by sourceUrl so a re-activation /
// another tab skips the importText round trip. Returns the canonical segment
// texts (for live-DOM matching) and the index→segment-id map (for saves).
export default class EnsureArticleSessionHandler {
  get sender() {
    return 'flicktionary-extension-highlight'
  }

  get command() {
    return 'ensure-article-session'
  }

  handle(
    command: Command<Message>,
    sender: Browser.runtime.MessageSender,
    sendResponse: (r?: EnsureArticleSessionResponse) => void
  ) {
    const message = command.message as EnsureArticleSessionMessage
    const tabId = sender.tab?.id

    void (async () => {
      if (tabId !== undefined) startBadgeBusy(tabId)
      try {
        await activateBackgroundLocale()
        const auth = await getFlicktionaryAuth()
        if (!auth) {
          if (tabId !== undefined) finishBadgeBusy(tabId, false)
          sendResponse({ success: false, signedIn: false })
          return
        }

        const cached = await lookupArticleSession(message.sourceUrl)
        const entry = cached ?? (await this._importAndCache(message))

        // Always list fresh (not cached): reflects deletions/edits from other
        // devices so a reload repaints the authoritative saved set.
        const highlights = await this._listHighlights(entry.sessionId, entry.segmentIdByIndex)

        if (tabId !== undefined) finishBadgeBusy(tabId, true)
        sendResponse({
          success: true,
          signedIn: true,
          sessionId: entry.sessionId,
          targetLanguage: entry.targetLanguage,
          segments: entry.segments,
          segmentIdByIndex: entry.segmentIdByIndex,
          highlights,
        })
      } catch (error) {
        if (tabId !== undefined) finishBadgeBusy(tabId, false)
        const { code, message: errorMessage } = extractFlicktionaryApiError(
          error,
          'Could not prepare this article for highlighting.'
        )
        sendResponse({ success: false, signedIn: true, code, error: errorMessage })
      }
    })()

    return true
  }

  private async _importAndCache(message: EnsureArticleSessionMessage): Promise<ArticleSessionCacheEntry> {
    const { data } = await getFlicktionaryApiClient().studySessions.importText({
      title: message.title,
      text: message.text,
      sourceUrl: message.sourceUrl,
    })

    const segmentIdByIndex: Record<string, string> = {}
    for (const segment of data.segments) {
      segmentIdByIndex[String(segment.index)] = segment.id
    }

    const entry: ArticleSessionCacheEntry = {
      sessionId: data.sessionId,
      targetLanguage: data.targetLanguage,
      segments: data.segments.map((s) => ({ index: s.index, text: s.text })),
      segmentIdByIndex,
    }
    await storeArticleSession(message.sourceUrl, entry)
    return entry
  }

  // Map the session's highlights to segment-index coordinates the content script
  // paints in. Single-segment only (the article flow never creates cross-segment
  // highlights); rows whose segment id isn't in the map are dropped.
  private async _listHighlights(
    sessionId: string,
    segmentIdByIndex: Readonly<Record<string, string>>
  ): Promise<SavedHighlightDto[]> {
    const indexBySegmentId: Record<string, number> = {}
    for (const [index, id] of Object.entries(segmentIdByIndex)) {
      indexBySegmentId[id] = Number(index)
    }

    const { data } = await getFlicktionaryApiClient().highlights.listBySession({ sessionId })
    const result: SavedHighlightDto[] = []
    for (const h of data) {
      const startSegmentIndex = indexBySegmentId[h.startSegmentId]
      const endSegmentIndex = indexBySegmentId[h.endSegmentId]
      if (startSegmentIndex === undefined || startSegmentIndex !== endSegmentIndex) continue
      result.push({
        id: h.id,
        startSegmentIndex,
        endSegmentIndex,
        startOffset: h.startOffset,
        endOffset: h.endOffset,
        selectionText: h.selectionText,
        note: h.note,
        presetTags: h.presetTags,
        fastGloss: h.fastGloss,
      })
    }
    return result
  }
}
