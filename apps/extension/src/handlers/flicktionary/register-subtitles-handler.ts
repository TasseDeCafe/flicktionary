import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  RegisterFlicktionarySubtitlesMessage,
  RegisterFlicktionarySubtitlesResponse,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { getFlicktionaryAuth } from '../../services/flicktionary/auth-storage'
import { storeFlicktionarySession } from '../../services/flicktionary/youtube-session-cache'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Receives the parsed subtitle payload at video-load time, creates (or fetches)
// the Flicktionary session, and caches the segment-index → text_segments.id
// map so subsequent saves don't need a round trip.
//
// Unpaired or save-disabled users still see the message arrive but get back
// `{ success: false }`; the binding simply leaves saving unavailable for the
// video (there is no local fallback — Flicktionary is the system of record).
export default class RegisterFlicktionarySubtitlesHandler {
  get sender(): string[] {
    return ['asbplayer-video', 'asbplayer-video-tab']
  }

  get command(): string {
    return 'register-flicktionary-subtitles'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: RegisterFlicktionarySubtitlesResponse) => void
  ) {
    const message = command.message as RegisterFlicktionarySubtitlesMessage

    void (async () => {
      try {
        const auth = await getFlicktionaryAuth()
        if (!auth) {
          sendResponse({ success: false, error: 'Not paired with Flicktionary' })
          return
        }

        const client = getFlicktionaryApiClient()
        const subtitles = {
          contentHash: message.contentHash,
          segments: message.segments.map((s) => ({ ...s })),
        }
        const { data } =
          message.source === 'youtube' && message.youtubeVideoId
            ? await client.studySessions.findOrCreateForYoutubeVideo({
                youtubeVideoId: message.youtubeVideoId,
                videoTitle: message.videoTitle,
                videoUrl: message.videoUrl,
                subtitles,
              })
            : await client.studySessions.findOrCreateForStreamingVideo({
                videoTitle: message.videoTitle,
                videoUrl: message.videoUrl,
                subtitles,
              })

        const segmentIdByIndex: Record<string, string> = {}
        for (const segment of data.segments) {
          segmentIdByIndex[String(segment.index)] = segment.id
        }
        await storeFlicktionarySession(message.source, message.contentHash, {
          sessionId: data.sessionId,
          textTrackId: data.textTrackId,
          contentSourceId: data.contentSourceId,
          targetLanguage: data.targetLanguage,
          segmentIdByIndex,
        })

        sendResponse({ success: true, sessionId: data.sessionId })
      } catch (error) {
        const { code, message: errorMessage } = extractFlicktionaryApiError(
          error,
          'register-flicktionary-subtitles failed'
        )
        sendResponse({ success: false, code, error: errorMessage })
      }
    })()

    return true
  }
}
