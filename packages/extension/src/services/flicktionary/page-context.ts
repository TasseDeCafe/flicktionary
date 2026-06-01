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

// Prefer the site page-script's clean basename (e.g. Netflix's
// "Show S01E02 Episode") when it's meaningful; otherwise fall back to the
// scrubbed page title. Many sites (notably Netflix) leave document.title as the
// bare site name during playback, so the basename is the better source when
// present. A purely-numeric basename is a Netflix titleId placeholder
// (metadata not ready yet) — treat it as no title and fall back.
export const pickStreamingTitle = (basename: string | undefined, pageTitle: string): string => {
  const cleaned = basename?.trim()
  if (cleaned && !/^\d+$/.test(cleaned)) return cleaned
  return pageTitle
}
