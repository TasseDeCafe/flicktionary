import type { IndexedSubtitleModel } from '@asbplayer-fork/common'

// Minimal video-level metadata the Flicktionary backend needs to identify a
// YouTube content_source. We sniff this from the page (URL + document.title)
// since the binding doesn't carry a dedicated YouTube data model.
export interface FlicktionaryYoutubeVideoMetadata {
  readonly youtubeVideoId: string
  readonly videoTitle: string
  readonly videoUrl: string
}

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com'])

export const isYoutubeWatchPage = (): boolean => {
  if (typeof window === 'undefined') return false
  if (!YOUTUBE_HOSTS.has(window.location.hostname)) return false
  return getYoutubeVideoId() !== null
}

export const getYoutubeVideoId = (): string | null => {
  try {
    const params = new URLSearchParams(window.location.search)
    const v = params.get('v')
    if (v && /^[A-Za-z0-9_-]{6,32}$/.test(v)) return v
  } catch {
    // ignore
  }
  return null
}

// Best-effort title scrub. YouTube's `document.title` is `Video Title - YouTube`;
// we trim the suffix so the saved content_source.title is the bare video name.
export const getYoutubeVideoTitle = (): string => {
  const raw = (typeof document !== 'undefined' ? document.title : '') || ''
  return raw.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'YouTube video'
}

export const getCurrentYoutubeMetadata = (): FlicktionaryYoutubeVideoMetadata | null => {
  const videoId = getYoutubeVideoId()
  if (!videoId) return null
  return {
    youtubeVideoId: videoId,
    videoTitle: getYoutubeVideoTitle(),
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
  }
}

// Normalize a YouTube caption-track language code into a displayable BCP-47
// code. YouTube codes are already BCP-47 (`ru`, `pt-BR`, `zh-Hans`), but this
// fork mints a synthetic `<target>_from_<source>` code for auto-translated
// tracks — the text the user reads is `<target>`, so we keep that prefix.
export const normalizeYoutubeLanguageCode = (code: string | undefined): string | undefined => {
  if (!code) return undefined
  const trimmed = code.trim()
  if (trimmed.length === 0) return undefined
  const fromIndex = trimmed.indexOf('_from_')
  const normalized = fromIndex === -1 ? trimmed : trimmed.slice(0, fromIndex)
  return normalized.length > 0 ? normalized : undefined
}

// Human-readable English name for a BCP-47 code (`ru` → "Russian",
// `pt-BR` → "Brazilian Portuguese"), used only to name an unsupported language
// in a notice. Returns undefined for unknown / unparseable codes.
export const describeLanguageCode = (code: string | undefined): string | undefined => {
  if (!code) return undefined
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code)
    // Intl returns the input unchanged when it can't resolve the code.
    return name && name.toLowerCase() !== code.toLowerCase() ? name : undefined
  } catch {
    return undefined
  }
}

// SHA-256 hex digest of the JSON serialization of the (offset-corrected,
// filter-applied) segments we send to the backend. Same content → same hash →
// same text_track row server-side, so re-opening the video is idempotent.
export const computeSubtitlesContentHash = async (
  segments: ReadonlyArray<{ index: number; text: string; startMs: number; endMs: number }>
): Promise<string> => {
  const json = JSON.stringify(segments)
  const encoder = new TextEncoder()
  const bytes = encoder.encode(json)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex
}

// Project the in-memory subtitle array (already offset-corrected and filtered
// by asbplayer's SubtitleReader) into the canonical wire shape — index/text
// verbatim, integer millisecond timestamps clamped to nonneg. Empty / image-
// only subtitles are dropped: text_segments.text is NOT NULL.
export const toFlicktionarySegments = (subtitles: IndexedSubtitleModel[]) => {
  return subtitles
    .filter((s) => s.text && s.text.trim().length > 0)
    .map((s) => ({
      index: s.index,
      text: s.text,
      startMs: Math.max(0, Math.round(s.start)),
      endMs: Math.max(0, Math.round(s.end)),
    }))
}
