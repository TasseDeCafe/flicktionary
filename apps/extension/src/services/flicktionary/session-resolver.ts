import type { SaveWordFlicktionaryVideoContext } from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from './flicktionary-api-client'
import {
  lookupFlicktionarySession,
  storeFlicktionarySession,
  type FlicktionaryYoutubeSessionCacheEntry,
} from './youtube-session-cache'

type SessionResponseData = {
  sessionId: string
  textTrackId: string
  contentSourceId: string
  targetLanguage: string
  segments: Array<{ id: string; index: number }>
}

const toCacheEntry = (data: SessionResponseData): FlicktionaryYoutubeSessionCacheEntry => {
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

// Resolve the Flicktionary session for a video: session cache → lookupForVideo
// probe (SELECT-only) → find-or-create from the shipped video context. The
// creating step is only reached from explicit user acts (a save, a checkpoint
// press) — merely loading subtitles never creates anything server-side.
export const resolveOrCreateFlicktionarySession = async (
  videoCtx: SaveWordFlicktionaryVideoContext
): Promise<FlicktionaryYoutubeSessionCacheEntry> => {
  const cached = await lookupFlicktionarySession(videoCtx.source, videoCtx.contentHash)
  if (cached) {
    return cached
  }

  const client = getFlicktionaryApiClient()
  const { data: found } = await client.studySessions.lookupForVideo({
    source: videoCtx.source,
    youtubeVideoId: videoCtx.youtubeVideoId,
    contentHash: videoCtx.contentHash,
  })
  if (found) {
    const entry = toCacheEntry(found)
    await storeFlicktionarySession(videoCtx.source, videoCtx.contentHash, entry)
    return entry
  }

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
  const entry = toCacheEntry(data)
  await storeFlicktionarySession(videoCtx.source, videoCtx.contentHash, entry)
  return entry
}
