// Persistent storage for the Flicktionary extension's Supabase session.
//
// Intentionally separate from `SettingsProvider` / `ExtensionSettingsStorage`:
// settings are profile-aware, syncable, and included in the user's settings
// export. Auth tokens are none of those things. Settings export/import code
// MUST never read or write this namespace.

const STORAGE_KEY = 'flicktionary.auth.v1'

export interface FlicktionaryAuthState {
  accessToken: string
  refreshToken: string
  /** Unix seconds at which `accessToken` expires (matches Supabase). */
  expiresAt: number
  userId: string
  email: string
}

const readRaw = async (): Promise<unknown> => {
  const result = await browser.storage.local.get(STORAGE_KEY)
  return (result as Record<string, unknown>)[STORAGE_KEY]
}

const isAuthState = (value: unknown): value is FlicktionaryAuthState => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.expiresAt === 'number' &&
    typeof v.userId === 'string' &&
    typeof v.email === 'string'
  )
}

export const getFlicktionaryAuth = async (): Promise<FlicktionaryAuthState | null> => {
  const value = await readRaw()
  return isAuthState(value) ? value : null
}

export const setFlicktionaryAuth = async (state: FlicktionaryAuthState): Promise<void> => {
  await browser.storage.local.set({ [STORAGE_KEY]: state })
}

export const clearFlicktionaryAuth = async (): Promise<void> => {
  await browser.storage.local.remove(STORAGE_KEY)
}

export const onFlicktionaryAuthChange = (listener: (state: FlicktionaryAuthState | null) => void): (() => void) => {
  const wrapped = (changes: { [key: string]: Browser.storage.StorageChange }, areaName: Browser.storage.AreaName) => {
    if (areaName !== 'local') return
    if (!(STORAGE_KEY in changes)) return
    const newValue = changes[STORAGE_KEY]?.newValue
    listener(isAuthState(newValue) ? newValue : null)
  }

  browser.storage.onChanged.addListener(wrapped)
  return () => browser.storage.onChanged.removeListener(wrapped)
}

/**
 * Key the settings export/import path MUST exclude. Exposed here so other code
 * can reference it by symbol rather than re-stringifying the constant.
 */
export const FLICKTIONARY_AUTH_STORAGE_KEY = STORAGE_KEY
