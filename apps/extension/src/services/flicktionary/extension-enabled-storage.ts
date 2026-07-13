// Persistent storage for the global extension on/off switch (popup master
// switch + the on-video re-enable pill).
//
// Like auth-storage, this is intentionally separate from `SettingsProvider` /
// `ExtensionSettingsStorage`: settings are profile-aware, syncable, and part of
// the user's settings export — the kill switch must be none of those things
// (switching profiles or importing settings must never re-enable the
// extension), and the export schema is strict (unknown keys throw on import).
// Settings export/import code MUST never read or write this namespace.

const STORAGE_KEY = 'flicktionary.extensionEnabled.v1'

export interface ExtensionEnabledState {
  enabled: boolean
}

// Default ON: only an explicitly stored `enabled: false` disables the extension.
const coerce = (value: unknown): ExtensionEnabledState => {
  if (!value || typeof value !== 'object') return { enabled: true }
  const v = value as Record<string, unknown>
  return { enabled: v.enabled !== false }
}

export const getExtensionEnabledState = async (): Promise<ExtensionEnabledState> => {
  const result = await browser.storage.local.get(STORAGE_KEY)
  return coerce((result as Record<string, unknown>)[STORAGE_KEY])
}

export const setExtensionEnabled = async (enabled: boolean): Promise<void> => {
  await browser.storage.local.set({ [STORAGE_KEY]: { enabled } })
}

export const onExtensionEnabledChange = (listener: (state: ExtensionEnabledState) => void): (() => void) => {
  const wrapped = (changes: { [key: string]: Browser.storage.StorageChange }, areaName: Browser.storage.AreaName) => {
    if (areaName !== 'local') return
    if (!(STORAGE_KEY in changes)) return
    listener(coerce(changes[STORAGE_KEY]?.newValue))
  }

  browser.storage.onChanged.addListener(wrapped)
  return () => browser.storage.onChanged.removeListener(wrapped)
}
