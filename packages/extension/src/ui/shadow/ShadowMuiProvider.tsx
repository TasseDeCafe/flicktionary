import { useMemo, type ReactNode } from 'react'
import createCache, { type EmotionCache } from '@emotion/cache'
import { CacheProvider } from '@emotion/react'
import ThemeProvider from '@mui/material/styles/ThemeProvider'
import CssBaseline from '@mui/material/CssBaseline'
import type { PaletteMode, ThemeOptions } from '@mui/material/styles'
import { createTheme } from '@asbplayer-fork/common/theme'
import { PortalContainerContext } from '@asbplayer-fork/common/components/portal-container-context'
import { I18nProvider } from '@lingui/react'
import { i18n, setupLingui } from '../lingui'

// Monotonic suffix so each cache gets a distinct emotion key. Multiple videos on
// one page each mount their own shadow root + cache; distinct keys keep their
// injected <style> blocks from being treated as one set. Emotion requires keys
// to be lowercase letters and hyphens only (NO digits), so the counter is
// rendered base-26 a–z: asbshadowa, asbshadowb, ...
let cacheSeq = 0

const nextCacheKey = (): string => {
  let n = cacheSeq++
  let suffix = ''
  do {
    suffix = String.fromCharCode(97 + (n % 26)) + suffix
    n = Math.floor(n / 26)
  } while (n > 0)
  return `asbshadow${suffix}`
}

export interface ShadowMuiProviderProps {
  // The shadow root the UI renders into. Emotion injects its <style> tags here.
  shadowRoot: ShadowRoot
  // Element inside `shadowRoot` that MUI portals target (see above).
  portalContainer: HTMLElement
  themeType: PaletteMode
  // Lingui locale to activate before mounting <I18nProvider> (per PopupUi). The
  // catalog is a per-realm singleton, so activate it here for every surface.
  language?: string
  children: ReactNode
}

// Bundles everything the existing MUI components need to render unchanged inside
// a shadow root: an emotion cache pointed at the root (so styles inject INTO the
// shadow tree, not document.head), the fork's MUI ThemeProvider + CssBaseline,
// the Lingui provider, and the portal-container context. This wrapper is the one
// piece of "MUI-in-shadow" wiring; it's intentionally isolated so the Radix
// thread can delete it wholesale once it swaps the components.
export function ShadowMuiProvider({
  shadowRoot,
  portalContainer,
  themeType,
  language,
  children,
}: ShadowMuiProviderProps) {
  const cache = useMemo<EmotionCache>(
    () =>
      createCache({
        key: nextCacheKey(),
        container: shadowRoot,
        prepend: true,
        // Never use emotion's prod-default "speedy" mode (CSSOM insertRule):
        // it leaves the injected <style> tags textually empty, and the
        // fullscreenchange re-parenting in shadow-host.ts disconnects +
        // reconnects the host, which discards each tag's stylesheet and
        // re-parses its (empty) text — silently wiping every MUI style until
        // a full reload. Non-speedy keeps rules as text, surviving any move.
        speedy: false,
      }),
    [shadowRoot]
  )
  // Inside a Shadow DOM, MUI's default `rem` typography resolves against the
  // host page's <html> font-size (YouTube sets 10px), shrinking everything. A
  // shadow root can't shield `rem`, so make MUI emit absolute px instead — this
  // pins typography/icon sizes regardless of the host root. (Spacing is already
  // px in MUI.)
  const theme = useMemo(() => {
    // pxToRem is honoured by MUI's createTypography at runtime but is absent from
    // the TypographyOptions input type (a known MUI typing gap), so cast.
    const overrides = { typography: { pxToRem: (size: number) => `${size}px` } } as unknown as ThemeOptions
    return createTheme(themeType, overrides)
  }, [themeType])

  if (language) {
    setupLingui(language)
  }

  return (
    <CacheProvider value={cache}>
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme={theme}>
          <PortalContainerContext.Provider value={portalContainer}>
            <CssBaseline />
            {children}
          </PortalContainerContext.Provider>
        </ThemeProvider>
      </I18nProvider>
    </CacheProvider>
  )
}
