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
