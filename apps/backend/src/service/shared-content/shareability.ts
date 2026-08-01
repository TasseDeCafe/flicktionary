import type {
  ContentSourceType,
  DbContentSource,
} from '../../transport/database/content-sources/content-sources-repository'
import type { DbTextTrack } from '../../transport/database/text-tracks/text-tracks-repository'

// Which source types may enter the public Explore catalog, and how.
//   'auto'   — published on successful ingest (moderation-gated), no user action
//   'opt-in' — published only on an explicit user request (paste-wizard
//              checkbox, session share toggle)
//   'none'   — never shareable. Movie/TV/streaming subtitle tracks are
//              excluded as a copyright posture: privately fetching subtitles
//              for your own study is one thing, running a browsable catalog of
//              them is another. Lessons are personal notes; adhoc is plumbing.
export type ShareMode = 'auto' | 'opt-in' | 'none'

export const SHARE_MODE_BY_SOURCE_TYPE: Record<ContentSourceType, ShareMode> = {
  youtube: 'auto',
  article: 'auto',
  text: 'opt-in',
  movie: 'none',
  tv: 'none',
  streaming: 'none',
  book: 'none',
  lesson: 'none',
  adhoc: 'none',
}

// 'auto' publishes fire on ingest; 'user' requests come from the paste-wizard
// checkbox or the share toggle. A user request may publish opt-in types too;
// an auto trigger may not.
export type PublishTrigger = 'auto' | 'user'

export const isShareAllowed = (type: ContentSourceType, trigger: PublishTrigger): boolean => {
  const mode = SHARE_MODE_BY_SOURCE_TYPE[type]
  if (mode === 'none') return false
  if (mode === 'opt-in') return trigger === 'user'
  return true
}

// Cross-user identity of shared content. YouTube sources are deduped
// per-user, so the video id — not the row or track id — is the real identity;
// everything else keys on the track's content hash (sha256 of the normalized
// text), which is identical across users who ingested the same text.
export const canonicalKeyForShare = (source: DbContentSource, track: DbTextTrack): string => {
  if (source.type === 'youtube') {
    const metadata = source.metadata as Record<string, unknown>
    const videoId = typeof metadata.youtubeVideoId === 'string' ? metadata.youtubeVideoId : null
    if (videoId) return `youtube:${videoId}`
  }
  return `hash:${track.hash}`
}
