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
  /** Null for anonymous guest sessions; always set for paired accounts. */
  email: string | null
  /** Anonymous guest session (gloss-only access, minted on first gloss). */
  isGuest: boolean
}

const readRaw = async (): Promise<unknown> => {
  const result = await browser.storage.local.get(STORAGE_KEY)
  return (result as Record<string, unknown>)[STORAGE_KEY]
}

// Stored records predating guest support have a string email and no `isGuest`
// key — they MUST keep validating (rejecting them would silently sign every
// paired user out on extension update), so `isGuest` is normalized rather than
// required and `email` accepts null.
const parseAuthState = (value: unknown): FlicktionaryAuthState | null => {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const validShape =
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.expiresAt === 'number' &&
    typeof v.userId === 'string' &&
    (typeof v.email === 'string' || v.email === null)
  if (!validShape) return null
  return {
    accessToken: v.accessToken as string,
    refreshToken: v.refreshToken as string,
    expiresAt: v.expiresAt as number,
    userId: v.userId as string,
    email: (v.email as string | null) ?? null,
    isGuest: v.isGuest === true,
  }
}

export const __parseAuthStateForTest = parseAuthState

export const getFlicktionaryAuth = async (): Promise<FlicktionaryAuthState | null> => {
  return parseAuthState(await readRaw())
}

/**
 * The stored auth only when it belongs to a full (paired) account — null for
 * guests. Feature handlers that must treat guests as signed out (saving,
 * checkpoints, CEFR, imports, prefs sync) gate on this instead of
 * `getFlicktionaryAuth`.
 */
export const getFullAccountFlicktionaryAuth = async (): Promise<FlicktionaryAuthState | null> => {
  const auth = await getFlicktionaryAuth()
  return auth && !auth.isGuest ? auth : null
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
    listener(parseAuthState(changes[STORAGE_KEY]?.newValue))
  }

  browser.storage.onChanged.addListener(wrapped)
  return () => browser.storage.onChanged.removeListener(wrapped)
}

/**
 * Key the settings export/import path MUST exclude. Exposed here so other code
 * can reference it by symbol rather than re-stringifying the constant.
 */
export const FLICKTIONARY_AUTH_STORAGE_KEY = STORAGE_KEY
