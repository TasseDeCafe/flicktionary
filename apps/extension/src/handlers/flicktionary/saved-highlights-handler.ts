import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  LoadFlicktionarySavedHighlightsMessage,
  LoadFlicktionarySavedHighlightsResponse,
  SavedHighlightDto,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { getFullAccountFlicktionaryAuth } from '../../services/flicktionary/auth-storage'
import {
  lookupFlicktionarySession,
  removeFlicktionarySession,
  storeFlicktionarySession,
  type FlicktionaryYoutubeSessionCacheEntry,
} from '../../services/flicktionary/youtube-session-cache'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Converts the backend Highlight rows (segment IDS) to overlay-consumable DTOs
// (segment INDEXES) via the inverted segmentIdByIndex map. Highlights whose
// segments don't resolve are dropped silently — they belong to a different
// track revision (e.g. regenerated subtitles) and can't be painted on this one.
const toSavedHighlightDtos = (
  rows: ReadonlyArray<{
    id: string
    startSegmentId: string
    endSegmentId: string
    startOffset: number
    endOffset: number
    selectionText: string
    note: string | null
    presetTags: string[]
    fastGloss: string | null
    studyIntent: {
      skills: Array<'meaning_recognition' | 'meaning_production' | 'pronunciation'>
      formScope: 'lemma' | 'form'
    } | null
    chunkId: string | null
    noteOnly: boolean
  }>,
  segmentIdByIndex: Record<string, string>
): SavedHighlightDto[] => {
  const indexBySegmentId: Record<string, number> = {}
  for (const [index, id] of Object.entries(segmentIdByIndex)) {
    indexBySegmentId[id] = Number(index)
  }
  const out: SavedHighlightDto[] = []
  for (const row of rows) {
    const startSegmentIndex = indexBySegmentId[row.startSegmentId]
    const endSegmentIndex = indexBySegmentId[row.endSegmentId]
    if (startSegmentIndex === undefined || endSegmentIndex === undefined) continue
    out.push({
      id: row.id,
      startSegmentIndex,
      endSegmentIndex,
      startOffset: row.startOffset,
      endOffset: row.endOffset,
      selectionText: row.selectionText,
      note: row.note,
      presetTags: row.presetTags,
      fastGloss: row.fastGloss,
      studyIntent: row.studyIntent,
      chunkId: row.chunkId,
      noteOnly: row.noteOnly,
    })
  }
  return out
}

// Loads the saved highlights for one video so the overlay can paint persistent
// spans. Session resolution: cache first; cold cache goes through the
// lookup-only `studySessions.lookupForVideo` (NEVER find-or-create — loading
// highlights must not mint sessions for videos the user merely watched).
// A cached session whose highlight listing fails is treated as stale (deleted
// in the web app): evict and re-resolve once via the lookup. Signed-out is a
// normal state (`signedIn: false`), not an error.
export default class LoadFlicktionarySavedHighlightsHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'load-flicktionary-saved-highlights'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: LoadFlicktionarySavedHighlightsResponse) => void
  ) {
    const message = command.message as LoadFlicktionarySavedHighlightsMessage

    void (async () => {
      try {
        const auth = await getFullAccountFlicktionaryAuth()
        if (!auth) {
          sendResponse({ success: true, signedIn: false })
          return
        }

        const cached = await lookupFlicktionarySession(message.source, message.contentHash)
        if (cached) {
          try {
            sendResponse(await this._listForSession(cached))
            return
          } catch {
            // Stale cache (session deleted in the web app, or the row otherwise
            // unreachable): evict and fall through to the lookup, which returns
            // null for a deleted session.
            await removeFlicktionarySession(message.source, message.contentHash)
          }
        }

        const resolved = await this._lookup(message)
        if (!resolved) {
          sendResponse({ success: true, signedIn: true, highlights: [] })
          return
        }
        await storeFlicktionarySession(message.source, message.contentHash, resolved)
        sendResponse(await this._listForSession(resolved))
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(
          error,
          'load-flicktionary-saved-highlights failed'
        )
        sendResponse({ success: false, signedIn: true, error: errorMessage })
      }
    })()

    return true
  }

  private async _lookup(
    message: LoadFlicktionarySavedHighlightsMessage
  ): Promise<FlicktionaryYoutubeSessionCacheEntry | null> {
    const client = getFlicktionaryApiClient()
    const { data } = await client.studySessions.lookupForVideo({
      source: message.source,
      youtubeVideoId: message.youtubeVideoId,
      contentHash: message.contentHash,
    })
    if (!data) return null
    const segmentIdByIndex: Record<string, string> = {}
    for (const segment of data.segments) {
      segmentIdByIndex[String(segment.index)] = segment.id
    }
    return {
      sessionId: data.sessionId,
      textTrackId: data.textTrackId,
      contentSourceId: data.contentSourceId,
      targetLanguage: data.targetLanguage,
      segmentIdByIndex,
    }
  }

  private async _listForSession(
    entry: FlicktionaryYoutubeSessionCacheEntry
  ): Promise<LoadFlicktionarySavedHighlightsResponse> {
    const client = getFlicktionaryApiClient()
    const { data } = await client.highlights.listBySession({ sessionId: entry.sessionId })
    return {
      success: true,
      signedIn: true,
      sessionId: entry.sessionId,
      targetLanguage: entry.targetLanguage,
      highlights: toSavedHighlightDtos(data, entry.segmentIdByIndex),
    }
  }
}
