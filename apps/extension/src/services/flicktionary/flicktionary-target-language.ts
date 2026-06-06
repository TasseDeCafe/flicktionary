// Caches the user's primary target language for the extension. Populated
// lazily from `extensionAuth.bootstrapPrefs()` on first save / register, then
// kept in sync via `setFlicktionaryTargetLanguage` (popup picker — future).
//
// The same bootstrap response also carries the user's NATIVE language, cached
// alongside so content-script UI (the track-select dialog's translation
// suggestion) can read it without a network call — content scripts must not
// hit the API directly.
//
// Persisted in `browser.storage.local` rather than asbplayer settings so it
// rides with the auth namespace boundary: the settings import/export flow
// never sees it, but it survives extension reloads.

import { getFlicktionaryApiClient } from './flicktionary-api-client'
import { onFlicktionaryAuthChange } from './auth-storage'

const STORAGE_KEY = 'flicktionary.target-language.v1'
const NATIVE_STORAGE_KEY = 'flicktionary.native-language.v1'

// `undefined` = unknown (next read refetches), `null` = known "no language"
// (short-circuits the refetch), string = cached language.
let memory: string | null | undefined = undefined

// Re-pairing as a different user must not keep serving the previous user's
// target/native language: reset to `undefined` (NOT `null`, which would mean a
// *known* "no language" and skip the refetch) and drop the storage cache so
// the next gloss/save bootstraps fresh prefs. Same module-level subscription
// pattern as ui-prefs-sync.
export const resetFlicktionaryLanguageCache = async (): Promise<void> => {
  memory = undefined
  await browser.storage.local.remove([STORAGE_KEY, NATIVE_STORAGE_KEY])
}

onFlicktionaryAuthChange(() => {
  void resetFlicktionaryLanguageCache()
})

const fetchAndCacheBootstrapPrefs = async (): Promise<{ primary: string | null }> => {
  const { data } = await getFlicktionaryApiClient().extensionAuth.bootstrapPrefs()
  const primary = data.primaryTargetLanguage ?? null
  if (primary) {
    await browser.storage.local.set({ [STORAGE_KEY]: primary })
  }
  if (data.nativeLanguage) {
    await browser.storage.local.set({ [NATIVE_STORAGE_KEY]: data.nativeLanguage })
  }
  return { primary }
}

export const getFlicktionaryTargetLanguage = async (): Promise<string | null> => {
  if (memory !== undefined) return memory
  const stored = await browser.storage.local.get([STORAGE_KEY, NATIVE_STORAGE_KEY])
  const value = stored[STORAGE_KEY]
  if (typeof value === 'string' && value.length > 0) {
    memory = value
    if (typeof stored[NATIVE_STORAGE_KEY] !== 'string') {
      // Paired before the native-language cache existed — backfill quietly.
      fetchAndCacheBootstrapPrefs().catch(() => {})
    }
    return value
  }

  try {
    const { primary } = await fetchAndCacheBootstrapPrefs()
    if (primary) {
      memory = primary
      return primary
    }
  } catch {
    // bootstrap may fail if unpaired or offline — caller falls back.
  }

  memory = null
  return null
}

// Storage-only read (no network): safe from content scripts. Empty until the
// background's first bootstrapPrefs call has run (first save / register).
export const getCachedFlicktionaryNativeLanguage = async (): Promise<string | null> => {
  const stored = await browser.storage.local.get(NATIVE_STORAGE_KEY)
  const value = stored[NATIVE_STORAGE_KEY]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export const setFlicktionaryTargetLanguage = async (language: string): Promise<void> => {
  memory = language
  await browser.storage.local.set({ [STORAGE_KEY]: language })
}
