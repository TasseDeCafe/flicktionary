import { create } from 'zustand'

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

// Read by the inline <head> script in index.html to apply the theme before first paint.
export const THEME_CACHE_KEY = 'flick.theme.resolved'

const LIGHT_THEME_COLOR = '#FACC15'
// Hex of the dark-mode `--background` token: hsl(224 71% 4%).
const DARK_THEME_COLOR = '#030711'

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

const resolveTheme = (pref: ThemePref): ResolvedTheme => (pref === 'system' ? (prefersDark() ? 'dark' : 'light') : pref)

const applyResolvedTheme = (resolved: ResolvedTheme) => {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, resolved)
  } catch {
    // localStorage can be unavailable (private mode); the inline script falls back to matchMedia.
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
}

type ThemeStore = {
  pref: ThemePref
  setPref: (pref: ThemePref) => void
  // Re-writes the resolved-theme cache from current state. Needed after
  // signOut's `localStorage.clear()`, which would otherwise wipe the cache
  // and cause a theme flash on the next load.
  recache: () => void
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  pref: 'system',

  setPref: (pref) => {
    set({ pref })
    applyResolvedTheme(resolveTheme(pref))
  },

  recache: () => {
    applyResolvedTheme(resolveTheme(get().pref))
  },
}))

// Follow live OS theme changes while the pref is 'system'.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { pref } = useThemeStore.getState()
  if (pref === 'system') {
    applyResolvedTheme(resolveTheme(pref))
  }
})

// No apply on module load: the inline index.html script already applied the
// cached resolved theme pre-paint, and the cache may reflect a server pref
// (e.g. explicit dark) that disagrees with the store's 'system' default until
// <UserUiPrefsSync /> delivers it — stomping it here would cause a flash.
