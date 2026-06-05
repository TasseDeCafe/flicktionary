// Persistent storage for admin/dev debugging toggles (popup Admin tab).
//
// Like auth-storage, this is intentionally separate from `SettingsProvider` /
// `ExtensionSettingsStorage`: settings are profile-aware, syncable, and part of
// the user's settings export — debug toggles are none of those things, and the
// export schema is strict (unknown keys throw on import). Settings
// export/import code MUST never read or write this namespace.

const STORAGE_KEY = 'flicktionary.devTools.v1'

export interface DevToolsState {
  /** Mount the floating notification/dialog test buttons on video pages. */
  notificationTestButtonsEnabled: boolean
}

const DEFAULT_STATE: DevToolsState = {
  notificationTestButtonsEnabled: false,
}

const coerce = (value: unknown): DevToolsState => {
  if (!value || typeof value !== 'object') return DEFAULT_STATE
  const v = value as Record<string, unknown>
  return {
    notificationTestButtonsEnabled: v.notificationTestButtonsEnabled === true,
  }
}

export const getDevToolsState = async (): Promise<DevToolsState> => {
  const result = await browser.storage.local.get(STORAGE_KEY)
  return coerce((result as Record<string, unknown>)[STORAGE_KEY])
}

export const setDevToolsState = async (changes: Partial<DevToolsState>): Promise<void> => {
  const current = await getDevToolsState()
  await browser.storage.local.set({ [STORAGE_KEY]: { ...current, ...changes } })
}

export const onDevToolsStateChange = (listener: (state: DevToolsState) => void): (() => void) => {
  const wrapped = (changes: { [key: string]: Browser.storage.StorageChange }, areaName: Browser.storage.AreaName) => {
    if (areaName !== 'local') return
    if (!(STORAGE_KEY in changes)) return
    listener(coerce(changes[STORAGE_KEY]?.newValue))
  }

  browser.storage.onChanged.addListener(wrapped)
  return () => browser.storage.onChanged.removeListener(wrapped)
}
