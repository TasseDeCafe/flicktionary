import type { ArticleSegmentDto } from '@asbplayer-fork/common'

// Background cache of "for this article URL, here is its Flicktionary session,
// its canonical segment texts, and the segment-index → segment-id map".
//
// Keyed by sourceUrl (NOT the backend content hash — the hash is
// sha256(parsed.map(s => '|'+s.text).join('\n')), which the extension can't
// cheaply reproduce). The backend `importText` is already idempotent on that
// hash, so this cache is purely a round-trip-avoidance optimization: a
// re-activation or another tab on the same URL skips the importText call. Stale
// content at the same URL just means a map mismatch → the save no-ops, which is
// acceptable for the ephemeral-paint stance.
//
// Survives background-script restarts via browser.storage.local.

// v2: extraction now prepends the article title as segment 0 — bumping the key
// drops v1 entries (whose cached segments predate the title) so re-visiting an
// already-imported article re-imports with the title rather than serving stale
// title-less segments. Re-import is idempotent on the (now title-inclusive) text
// hash, so this just produces the up-to-date session.
const STORAGE_KEY = 'flicktionary.article-session-cache.v2'

export interface ArticleSessionCacheEntry {
  readonly sessionId: string
  readonly targetLanguage: string
  readonly segments: ReadonlyArray<ArticleSegmentDto>
  readonly segmentIdByIndex: Readonly<Record<string, string>>
}

type CacheMap = Record<string, ArticleSessionCacheEntry>

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

export const lookupArticleSession = async (sourceUrl: string): Promise<ArticleSessionCacheEntry | null> => {
  const cache = await readCache()
  return cache[sourceUrl] ?? null
}

export const storeArticleSession = async (sourceUrl: string, entry: ArticleSessionCacheEntry): Promise<void> => {
  const cache = { ...(await readCache()) }
  cache[sourceUrl] = entry
  await writeCache(cache)
}
