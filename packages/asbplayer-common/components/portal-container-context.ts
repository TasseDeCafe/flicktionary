import { createContext, useContext } from 'react'

// Portal target for MUI components that escape their parent DOM (Modal / Dialog
// / Popover / Menu / Tooltip). When the extension renders these components inside
// a Shadow DOM it provides this context (via ShadowMuiProvider) pointing at an
// element INSIDE that shadow root, so the portalled nodes stay in the root and
// pick up emotion's shadow-scoped styles. Outside such a provider the value is
// undefined, so MUI falls back to document.body — the unchanged behaviour for
// the standalone popup/options pages and the web app.
//
// Defined in the common package so the shared components below can consume it
// without importing from the extension package.
export const PortalContainerContext = createContext<HTMLElement | undefined>(undefined)

export const usePortalContainer = (): HTMLElement | undefined => useContext(PortalContainerContext)
