// In-memory + extension-local cache of "for this YouTube video + subtitle
// hash, here is the Flicktionary session + the segment-index → segment-id map".
//
// Populated by `register-flicktionary-subtitles` when subtitles load. Read by
// the save-word path so each saved highlight cites a real `text_segments.id`
// without a round trip per save. Survives background-script restarts via
// `browser.storage.local`; survives Supabase token refresh because it's
// independent of auth state.

const STORAGE_KEY = 'flicktionary.youtube-session-cache.v1';

export interface FlicktionaryYoutubeSessionCacheEntry {
    readonly sessionId: string;
    readonly textTrackId: string;
    readonly contentSourceId: string;
    readonly segmentIdByIndex: Record<string, string>;
}

type CacheMap = Record<string, FlicktionaryYoutubeSessionCacheEntry>;

const cacheKey = (videoId: string, contentHash: string) => `${videoId}:${contentHash}`;

let memoryCache: CacheMap | null = null;

const readCache = async (): Promise<CacheMap> => {
    if (memoryCache !== null) return memoryCache;
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const raw = stored[STORAGE_KEY];
    memoryCache = raw && typeof raw === 'object' ? (raw as CacheMap) : {};
    return memoryCache;
};

const writeCache = async (cache: CacheMap): Promise<void> => {
    memoryCache = cache;
    await browser.storage.local.set({ [STORAGE_KEY]: cache });
};

export const lookupFlicktionarySession = async (
    videoId: string,
    contentHash: string
): Promise<FlicktionaryYoutubeSessionCacheEntry | null> => {
    const cache = await readCache();
    return cache[cacheKey(videoId, contentHash)] ?? null;
};

export const storeFlicktionarySession = async (
    videoId: string,
    contentHash: string,
    entry: FlicktionaryYoutubeSessionCacheEntry
): Promise<void> => {
    const cache = { ...(await readCache()) };
    cache[cacheKey(videoId, contentHash)] = entry;
    await writeCache(cache);
};

export const clearFlicktionarySessionCache = async (): Promise<void> => {
    memoryCache = {};
    await browser.storage.local.remove(STORAGE_KEY);
};
