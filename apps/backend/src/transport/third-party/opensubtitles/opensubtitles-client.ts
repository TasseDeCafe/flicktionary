import { getConfig } from '../../../config/environment-config'
import { UpstreamRateLimitError } from '../upstream-rate-limit-error'

const OPENSUBTITLES_BASE_URL = 'https://api.opensubtitles.com/api/v1'

// OpenSubtitles signals limits with two distinct statuses: 429 for transient
// request-rate throttling (any endpoint), and 406 on POST /download when the
// daily download quota — shared across all our users via the single API key —
// is spent. Exported so the mapping is unit-testable without stubbing fetch.
export const classifyOpenSubtitlesFailure = (
  label: string,
  response: { status: number; statusText: string },
  options: { isDownload?: boolean } = {}
): Error => {
  if (response.status === 429) {
    return new UpstreamRateLimitError('opensubtitles', 'rate_limited', `OpenSubtitles ${label} rate limited (429)`)
  }
  if (options.isDownload && response.status === 406) {
    return new UpstreamRateLimitError(
      'opensubtitles',
      'quota_exceeded',
      'OpenSubtitles daily download quota exceeded (406)'
    )
  }
  return new Error(`OpenSubtitles ${label} failed: ${response.status} ${response.statusText}`)
}

export type OpenSubtitlesTrack = {
  // The id used to download (file_id, not subtitle_id).
  fileId: number
  language: string
  release: string
  fps: number | null
  hearingImpaired: boolean
  uploaderName: string | null
  downloadCount: number
}

type SearchResponse = {
  data: Array<{
    attributes: {
      language: string
      release: string
      fps: number | null
      hearing_impaired: boolean
      download_count: number
      uploader: { name: string | null } | null
      files: Array<{ file_id: number }>
    }
  }>
}

type DownloadResponse = {
  link: string
  file_name: string
}

const headers = (): Record<string, string> => ({
  'Api-Key': getConfig().openSubtitlesApiKey,
  'User-Agent': getConfig().openSubtitlesUserAgent,
  'Content-Type': 'application/json',
  Accept: 'application/json',
})

export const searchByTmdbId = async (tmdbId: number, language: string): Promise<OpenSubtitlesTrack[]> => {
  const params = new URLSearchParams({
    tmdb_id: String(tmdbId),
    languages: language,
    order_by: 'download_count',
    order_direction: 'desc',
  })
  const url = `${OPENSUBTITLES_BASE_URL}/subtitles?${params.toString()}`
  const response = await fetch(url, { headers: headers() })
  if (!response.ok) {
    throw classifyOpenSubtitlesFailure('search', response)
  }
  const data = (await response.json()) as SearchResponse
  return data.data
    .filter((row) => row.attributes.files.length > 0)
    .map((row) => ({
      fileId: row.attributes.files[0]!.file_id,
      language: row.attributes.language,
      release: row.attributes.release,
      fps: row.attributes.fps,
      hearingImpaired: row.attributes.hearing_impaired,
      uploaderName: row.attributes.uploader?.name ?? null,
      downloadCount: row.attributes.download_count,
    }))
    .sort((a, b) => b.downloadCount - a.downloadCount)
}

export const searchEpisodeSubtitles = async (params: {
  tmdbShowId: number
  seasonNumber: number
  episodeNumber: number
  language: string
}): Promise<OpenSubtitlesTrack[]> => {
  const query = new URLSearchParams({
    parent_tmdb_id: String(params.tmdbShowId),
    season_number: String(params.seasonNumber),
    episode_number: String(params.episodeNumber),
    type: 'episode',
    languages: params.language,
    order_by: 'download_count',
    order_direction: 'desc',
  })
  const url = `${OPENSUBTITLES_BASE_URL}/subtitles?${query.toString()}`
  const response = await fetch(url, { headers: headers() })
  if (!response.ok) {
    throw classifyOpenSubtitlesFailure('episode search', response)
  }
  const data = (await response.json()) as SearchResponse
  return data.data
    .filter((row) => row.attributes.files.length > 0)
    .map((row) => ({
      fileId: row.attributes.files[0]!.file_id,
      language: row.attributes.language,
      release: row.attributes.release,
      fps: row.attributes.fps,
      hearingImpaired: row.attributes.hearing_impaired,
      uploaderName: row.attributes.uploader?.name ?? null,
      downloadCount: row.attributes.download_count,
    }))
    .sort((a, b) => b.downloadCount - a.downloadCount)
}

// Two-step download per OpenSubtitles API: request a short-lived URL via POST /download,
// then GET the URL for the raw SRT body.
export const downloadSrtByFileId = async (fileId: number): Promise<string> => {
  const linkResponse = await fetch(`${OPENSUBTITLES_BASE_URL}/download`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ file_id: fileId }),
  })
  if (!linkResponse.ok) {
    throw classifyOpenSubtitlesFailure('download (link)', linkResponse, { isDownload: true })
  }
  const linkData = (await linkResponse.json()) as DownloadResponse

  const srtResponse = await fetch(linkData.link)
  if (!srtResponse.ok) {
    throw new Error(`OpenSubtitles download (file) failed: ${srtResponse.status} ${srtResponse.statusText}`)
  }
  return await srtResponse.text()
}
