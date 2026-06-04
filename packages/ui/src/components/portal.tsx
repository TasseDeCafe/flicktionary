import { createContext, useContext } from 'react'

// Default portal target for portal-using ui components (dialog, popover,
// tooltip, select, ...). The default (null) leaves Radix's own fallback —
// document.body — so web consumers are unaffected and need no provider.
//
// The extension's shadow-DOM surfaces provide their in-shadow portal container
// here so portalled content stays inside the shadow tree: it keeps the adopted
// Tailwind stylesheet, survives fullscreen re-parenting, and inherits the
// surface's `.dark` class (the provider mirrors it onto the container, which is
// a sibling of the React root).
export const PortalContainerContext = createContext<HTMLElement | null>(null)

export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext)
}
