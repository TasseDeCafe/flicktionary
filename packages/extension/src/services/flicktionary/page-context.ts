// Best-effort page-level video metadata for non-YouTube streaming sites
// (Netflix, Prime, …). The fork carries no per-site data model, so we sniff the
// page title + URL. The backend keys the content_source by the subtitle
// contentHash (NOT by this metadata), so title/url are display / back-link only
// — a rough title is acceptable.

export interface FlicktionaryStreamingVideoMetadata {
  readonly videoTitle: string
  readonly videoUrl: string
}

// Trailing "<title> - Netflix" / "<title> | Prime Video" style site suffixes.
const TITLE_SITE_SUFFIX = /\s*[-|–—]\s*(Netflix|Prime Video|Amazon[^|–—-]*|Disney\+?|Max|Hulu|HBO[^|–—-]*)\s*$/i

export const getCurrentStreamingMetadata = (): FlicktionaryStreamingVideoMetadata => {
  const rawTitle = (typeof document !== 'undefined' ? document.title : '') || ''
  const videoTitle = rawTitle.replace(TITLE_SITE_SUFFIX, '').trim() || rawTitle.trim() || 'Video'
  const videoUrl = typeof window !== 'undefined' ? window.location.href : ''
  return { videoTitle, videoUrl }
}

// Pick the best available streaming title from ordered candidates, first match
// wins. Intended order:
//   1. the site page-script's clean basename (e.g. "Breaking Bad S01E01 Pilot"),
//   2. the loaded subtitle's "Video Name" (the same basename plus a track-label
//      suffix — exactly what the Select Subtitles dialog shows; always present
//      at register time),
//   3. the scrubbed page title (document.title) as a last resort.
// Many sites (notably Netflix) leave document.title as the bare site name during
// playback, so (1)/(2) are the real sources. A purely-numeric candidate is a
// Netflix titleId placeholder (metadata not ready yet) and is skipped.
export const pickStreamingTitle = (...candidates: Array<string | undefined>): string => {
  for (const candidate of candidates) {
    const cleaned = candidate?.trim()
    if (cleaned && !/^\d+$/.test(cleaned)) return cleaned
  }
  return 'Video'
}
