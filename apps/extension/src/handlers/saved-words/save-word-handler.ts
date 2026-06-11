import type { Browser } from 'wxt/browser'
import type { Command, Message, SavedHighlightDto, SaveWordMessage, SaveWordResponse } from '@asbplayer-fork/common'
import { msg } from '@lingui/core/macro'
import { getFlicktionaryAuth } from '../../services/flicktionary/auth-storage'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { lookupFlicktionarySession, storeFlicktionarySession } from '../../services/flicktionary/youtube-session-cache'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'
import { activateBackgroundLocale } from '../../services/activate-background-locale'
import { i18n } from '../../ui/lingui'

// Saves a word-click / chunk selection as a Flicktionary highlight.
//
// Flicktionary (Supabase) is the system of record — the old local IndexedDB
// fallback was removed. When a save can't reach Flicktionary, we surface a
// descriptive error so the content script can show a toast rather than
// silently dropping the word.
export default class SaveWordHandler {
  get sender() {
    return ['asbplayer-video-tab', 'asbplayerv2']
  }

  get command() {
    return 'save-word'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (r?: SaveWordResponse) => void
  ) {
    const message = command.message as SaveWordMessage

    void (async () => {
      try {
        await activateBackgroundLocale()
        const { highlight, sessionId } = await this._saveToFlicktionary(message)
        sendResponse({ success: true, highlight, sessionId })
      } catch (error) {
        const {
          code,
          message: errorMessage,
          targetLanguage,
        } = extractFlicktionaryApiError(error, 'Failed to save to Flicktionary')
        sendResponse({ success: false, code, error: errorMessage, targetLanguage })
      }
    })()

    return true
  }

  // Returns the created highlight as an index-based DTO (segment ids converted
  // back through the cached map) so the overlay can paint the saved span
  // optimistically, plus the session id (the overlay's store has no session
  // before the video's first save). Highlight undefined when a segment id
  // doesn't resolve — the overlay then falls back to a full reload.
  private async _saveToFlicktionary(
    message: SaveWordMessage
  ): Promise<{ highlight: SavedHighlightDto | undefined; sessionId: string }> {
    const auth = await getFlicktionaryAuth()
    if (!auth) {
      throw new Error(i18n._(msg`Sign in to Flicktionary to save words.`))
    }

    const videoCtx = message.flicktionaryVideo
    if (!videoCtx) {
      // Save originated without a subtitle context (e.g. the asbplayerv2 web
      // app, or a video opened before subtitles loaded).
      throw new Error('Reload the video, then try saving again.')
    }
    if (
      message.segmentIndex === undefined ||
      message.startCharOffset === undefined ||
      message.endCharOffset === undefined
    ) {
      throw new Error('Could not locate this word in the subtitles.')
    }

    const client = getFlicktionaryApiClient()
    let cached = await lookupFlicktionarySession(videoCtx.source, videoCtx.contentHash)

    if (!cached) {
      const subtitles = {
        contentHash: videoCtx.contentHash,
        segments: videoCtx.segments.map((s) => ({ ...s })),
      }
      const { data } =
        videoCtx.source === 'youtube' && videoCtx.youtubeVideoId
          ? await client.studySessions.findOrCreateForYoutubeVideo({
              youtubeVideoId: videoCtx.youtubeVideoId,
              videoTitle: videoCtx.videoTitle,
              videoUrl: videoCtx.videoUrl,
              subtitles,
            })
          : await client.studySessions.findOrCreateForStreamingVideo({
              videoTitle: videoCtx.videoTitle,
              videoUrl: videoCtx.videoUrl,
              subtitles,
            })
      const segmentIdByIndex: Record<string, string> = {}
      for (const segment of data.segments) {
        segmentIdByIndex[String(segment.index)] = segment.id
      }
      cached = {
        sessionId: data.sessionId,
        textTrackId: data.textTrackId,
        contentSourceId: data.contentSourceId,
        segmentIdByIndex,
      }
      await storeFlicktionarySession(videoCtx.source, videoCtx.contentHash, cached)
    }

    const startSegmentId = cached.segmentIdByIndex[String(message.segmentIndex)]
    const endSegmentId =
      message.endSegmentIndex !== undefined ? cached.segmentIdByIndex[String(message.endSegmentIndex)] : startSegmentId
    if (!startSegmentId || !endSegmentId) {
      throw new Error('Could not map this word to a subtitle segment.')
    }

    const { data: created } = await client.highlights.create({
      sessionId: cached.sessionId,
      startSegmentId,
      endSegmentId,
      startOffset: message.startCharOffset,
      endOffset: message.endCharOffset,
      selectionText: message.word,
      // Study options from the gloss tooltip; the backend enrichment job
      // applies them once the term materializes (full-set semantics).
      studyIntent: message.studyIntent,
    })

    const indexBySegmentId: Record<string, number> = {}
    for (const [index, id] of Object.entries(cached.segmentIdByIndex)) {
      indexBySegmentId[id] = Number(index)
    }
    const startSegmentIndex = indexBySegmentId[created.startSegmentId]
    const endSegmentIndex = indexBySegmentId[created.endSegmentId]
    if (startSegmentIndex === undefined || endSegmentIndex === undefined) {
      return { highlight: undefined, sessionId: cached.sessionId }
    }
    return {
      highlight: {
        id: created.id,
        startSegmentIndex,
        endSegmentIndex,
        startOffset: created.startOffset,
        endOffset: created.endOffset,
        selectionText: created.selectionText,
        note: created.note,
        presetTags: created.presetTags,
        fastGloss: created.fastGloss,
      },
      sessionId: cached.sessionId,
    }
  }
}
