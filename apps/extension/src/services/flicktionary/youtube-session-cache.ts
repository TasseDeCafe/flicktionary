// In-memory + extension-local cache of "for this video (by ingestion source +
// subtitle hash), here is the Flicktionary session + the segment-index →
// segment-id map".
//
// Populated by a video's first save (save-word-handler's findOrCreate) or by
// the saved-highlights loader's session lookup. Read by the save-word path so
// each saved highlight cites a real `text_segments.id` without a round trip
// per save. Survives background-script restarts via `browser.storage.local`;
// survives Supabase token refresh because it's independent of auth state.
//
// Keyed by (source, contentHash) so YouTube and streaming sessions never alias,
// even in the (vanishingly unlikely) case of byte-identical subtitle content.

// v3: entries gained `targetLanguage`. Bumping the key drops v2 entries
// wholesale instead of migrating — find-or-create is idempotent, so the next
// save simply repopulates the entry with the new field.
const STORAGE_KEY = 'flicktionary.session-cache.v3'

export interface FlicktionaryYoutubeSessionCacheEntry {
  readonly sessionId: string
  readonly textTrackId: string
  readonly contentSourceId: string
  // The server-detected subtitle language (= session target language) — feeds
  // the overlay's Intl.Segmenter locale so tokenization matches the web reader.
  readonly targetLanguage: string
  readonly segmentIdByIndex: Record<string, string>
}

type CacheMap = Record<string, FlicktionaryYoutubeSessionCacheEntry>

const cacheKey = (source: string, contentHash: string) => `${source}:${contentHash}`

let memoryCache: CacheMap | null = null

const readCache = async (): Promise<CacheMap> => {
  if (memoryCache !== null) return memoryCache
  const stored = await browser.storage.local.get(STORAGE_KEY)
  const raw = stored[STORAGE_KEY]
  memoryCache = raw && typeof raw === 'object' ? (raw as CacheMap) : {}
  return memoryCache
}

const writeCache = async (cache: CacheMap): Promise<void> => {
  memoryCache = cache
  await browser.storage.local.set({ [STORAGE_KEY]: cache })
}

export const lookupFlicktionarySession = async (
  source: string,
  contentHash: string
): Promise<FlicktionaryYoutubeSessionCacheEntry | null> => {
  const cache = await readCache()
  return cache[cacheKey(source, contentHash)] ?? null
}

export const storeFlicktionarySession = async (
  source: string,
  contentHash: string,
  entry: FlicktionaryYoutubeSessionCacheEntry
): Promise<void> => {
  const cache = { ...(await readCache()) }
  cache[cacheKey(source, contentHash)] = entry
  await writeCache(cache)
}

// Evict one video's entry — used when the cached session turns out to be stale
// (e.g. the user deleted the session in the web app and listing its highlights
// 404s). The next load/save re-resolves via lookupForVideo / find-or-create.
export const removeFlicktionarySession = async (source: string, contentHash: string): Promise<void> => {
  const cache = { ...(await readCache()) }
  delete cache[cacheKey(source, contentHash)]
  await writeCache(cache)
}

export const clearFlicktionarySessionCache = async (): Promise<void> => {
  memoryCache = {}
  await browser.storage.local.remove(STORAGE_KEY)
}
