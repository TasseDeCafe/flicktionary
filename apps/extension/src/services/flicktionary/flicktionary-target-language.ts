// Caches the user's primary target language for the extension. Populated
// lazily from `extensionAuth.bootstrapPrefs()` on first save / register, then
// kept in sync via `setFlicktionaryTargetLanguage` (popup picker — future).
//
// Persisted in `browser.storage.local` rather than asbplayer settings so it
// rides with the auth namespace boundary: the settings import/export flow
// never sees it, but it survives extension reloads.

import { getFlicktionaryApiClient } from './flicktionary-api-client'

const STORAGE_KEY = 'flicktionary.target-language.v1'

let memory: string | null | undefined = undefined

export const getFlicktionaryTargetLanguage = async (): Promise<string | null> => {
  if (memory !== undefined) return memory
  const stored = await browser.storage.local.get(STORAGE_KEY)
  const value = stored[STORAGE_KEY]
  if (typeof value === 'string' && value.length > 0) {
    memory = value
    return value
  }

  try {
    const { data } = await getFlicktionaryApiClient().extensionAuth.bootstrapPrefs()
    const primary = data.primaryTargetLanguage ?? null
    if (primary) {
      await browser.storage.local.set({ [STORAGE_KEY]: primary })
      memory = primary
      return primary
    }
  } catch {
    // bootstrap may fail if unpaired or offline — caller falls back.
  }

  memory = null
  return null
}

export const setFlicktionaryTargetLanguage = async (language: string): Promise<void> => {
  memory = language
  await browser.storage.local.set({ [STORAGE_KEY]: language })
}

export const clearFlicktionaryTargetLanguage = async (): Promise<void> => {
  memory = null
  await browser.storage.local.remove(STORAGE_KEY)
}
