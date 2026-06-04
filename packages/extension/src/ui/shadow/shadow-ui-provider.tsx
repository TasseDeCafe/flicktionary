import { useEffect, type ReactNode } from 'react'
import { I18nProvider } from '@lingui/react'
import { PortalContainerContext } from '@flicktionary/ui/components/portal'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { i18n, setupLingui } from '../lingui'

// Base classes both top-level containers need: there is no <body> inside a
// shadow tree to supply the shadcn base font/text colour, and `color` is
// inherited as a COMPUTED value — so it must be (re-)resolved on an element at
// or below the `.dark` class, not on the shadow host.
const baseClasses = 'font-sans text-foreground'

export interface ShadowUiProviderProps {
  // Element inside the surface's shadow root that portal-using ui components
  // (dialog, popover, select, ...) target via PortalContainerContext. Pass the
  // portalContainer div from ShadowMountContext, never the ShadowRoot.
  portalContainer: HTMLElement
  themeType: 'dark' | 'light'
  // Lingui locale to activate before mounting <I18nProvider> (per PopupUi). The
  // catalog is a per-realm singleton, so activate it here for every surface.
  language?: string
  children: ReactNode
}

// The Radix/Tailwind replacement for ShadowMuiProvider: Lingui + portal-target
// context + class-driven dark mode. No emotion cache and no theme object — the
// adopted Tailwind sheet (overlay-stylesheet.ts) already styles the whole
// shadow tree and is immune to fullscreen re-parenting.
//
// Dark mode: settings.themeType drives a `.dark` class that must land BOTH on
// the in-tree wrapper (for inline-rendered content) AND on portalContainer —
// portalled dialog/popover/select content renders under portalContainer, a
// SIBLING of the React root (see shadow-host.ts), so it would never inherit a
// class from inside the React tree.
export function ShadowUiProvider({ portalContainer, themeType, language, children }: ShadowUiProviderProps) {
  if (language) {
    setupLingui(language)
  }

  const dark = themeType === 'dark'

  useEffect(() => {
    portalContainer.classList.add('font-sans', 'text-foreground')
    portalContainer.classList.toggle('dark', dark)
  }, [portalContainer, dark])

  return (
    <I18nProvider i18n={i18n}>
      <PortalContainerContext.Provider value={portalContainer}>
        <div className={cn(baseClasses, dark && 'dark')}>{children}</div>
      </PortalContainerContext.Provider>
    </I18nProvider>
  )
}
