import { useEffect, useState } from 'react'
import { resolveTheme, type ResolvedTheme, type ThemeType } from '@asbplayer-fork/common/settings'

// Resolves 'system' against this realm's matchMedia and re-renders on live OS
// theme changes while the preference is 'system'.
export const useResolvedTheme = (themeType: ThemeType | undefined): ResolvedTheme | undefined => {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (themeType !== 'system') {
      return
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => setTick((t) => t + 1)
    mql.addEventListener('change', listener)
    return () => mql.removeEventListener('change', listener)
  }, [themeType])

  return themeType === undefined ? undefined : resolveTheme(themeType)
}
