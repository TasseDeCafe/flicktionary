import { extractExtension } from '@/pages/util'
import { inferTracksFromInterceptedMpdViaXMLHTTPRequest } from '@/pages/mpd-util'

export default defineUnlistedScript(() => {
  const deduplication: { [key: string]: number } = {}

  inferTracksFromInterceptedMpdViaXMLHTTPRequest(/https:\/\/.+\.mpd/, (playlist, language) => {
    const name = playlist.attributes?.NAME as string | undefined
    // `${name}` mirrors the coercion the untyped code relied on: unnamed playlists
    // all deduplicate under the literal "undefined" key.
    const dedupKey = `${name}`
    const playlistNumber = dedupKey in deduplication ? deduplication[dedupKey] + 1 : 0
    deduplication[dedupKey] = playlistNumber
    const deduplicatedName = `${name}-${playlistNumber}`
    const segmentUrls = playlist.segments.map((s) => s.resolvedUri)
    return {
      label: name === undefined ? language : `${language} - ${deduplicatedName}`,
      language,
      url: segmentUrls,
      extension: extractExtension(playlist.resolvedUri, 'vtt'),
    }
  })
})
