export type ThemeType = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

// Resolve at the consumer edge, with the consuming realm's own matchMedia:
// 'system' flows through controller messages/models unresolved so each surface
// keeps following live OS theme changes instead of freezing the value at the
// point a message was built.
export const resolveTheme = (themeType: ThemeType): ResolvedTheme => {
  if (themeType === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return themeType
}
