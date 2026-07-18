import { useSyncExternalStore } from 'react'

// The canvas renderers read their colors from CSS custom properties at paint
// time, so they must repaint when the theme flips. The `.dark` class on
// <html> is the single source of truth (the theme store toggles it for both
// explicit prefs and live OS changes), so observing the DOM covers every path
// with one mechanism.
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const getSnapshot = (): 'light' | 'dark' => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

export const useResolvedTheme = (): 'light' | 'dark' => {
  return useSyncExternalStore(subscribe, getSnapshot)
}
