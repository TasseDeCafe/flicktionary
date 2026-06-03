import { createElement } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { Toaster } from 'sonner'
import { overlaySheet } from '../shadow/overlay-stylesheet'

// Mirrors the extension's `themeType` setting ('dark' | 'light').
export type ToasterTheme = 'dark' | 'light'

const TOASTER_HOST_ATTR = 'data-asbplayer-toaster-host'

// Our overlays sit at max-int; sonner's default toaster z-index (999999999)
// would render below them. Inline style beats sonner's stylesheet rule.
const TOASTER_Z_INDEX = 2147483647

interface ToasterHost {
  host: HTMLElement
  root: Root
  onFullscreenChange: () => void
}

// One page-global Toaster for the whole document. Viewport-corner toasts are
// page-level, so a singleton is the right model — it also avoids duplicate
// stacks when several videos share a page. sonner's `toast()` dispatches to it
// imperatively, so the (non-React) SubtitleController can drive it.
let singleton: ToasterHost | undefined

// Current toaster theme. We pass this to sonner EXPLICITLY rather than using its
// `theme="system"` — `system` tracks the OS via matchMedia, but we want to
// follow the extension's own themeType setting. Defaults to dark (the
// extension's default) until _refreshSettings pushes the real value.
let currentTheme: ToasterTheme = 'dark'

// sonner sets `data-sonner-theme` from this prop; the palette for both themes is
// in the adopted stylesheet, so the toaster is colored correctly in the shadow root.
function renderToaster(root: Root): void {
  root.render(
    createElement(Toaster, { position: 'bottom-right', theme: currentTheme, style: { zIndex: TOASTER_Z_INDEX } })
  )
}

// Follow the extension's themeType. Re-renders the live toaster if it exists, so
// a settings change recolors toasts without recreating the host.
export function setToasterTheme(theme: ToasterTheme): void {
  if (theme === currentTheme) {
    return
  }
  currentTheme = theme
  if (singleton) {
    renderToaster(singleton.root)
  }
}

// Stand up the singleton Toaster (idempotent). Call before the first `toast()`.
export function ensureToasterHost(): void {
  if (singleton) {
    return
  }

  // Remove any toaster hosts stranded by a previous script load / HMR.
  document.querySelectorAll(`[${TOASTER_HOST_ATTR}]`).forEach((el) => el.remove())

  const host = document.createElement('div')
  host.setAttribute(TOASTER_HOST_ATTR, '')
  const shadow = host.attachShadow({ mode: 'open' })
  // Adopt the overlay sheet (which now carries sonner's CSS) so the toaster is
  // styled inside the shadow root — sonner's head-injected copy can't reach in.
  shadow.adoptedStyleSheets = [overlaySheet()]
  const container = document.createElement('div')
  shadow.appendChild(container)

  // Reparent under the fullscreen element so `position: fixed` keeps working and
  // the toaster stays visible in fullscreen (it must not live inside a
  // transformed ancestor). Mirrors mount.ts's popover-host placement.
  const placeHost = () => {
    const parent = document.fullscreenElement ?? document.body
    if (host.parentElement !== parent) {
      parent.appendChild(host)
    }
  }
  placeHost()
  const onFullscreenChange = () => placeHost()
  document.addEventListener('fullscreenchange', onFullscreenChange)

  const root = createRoot(container)
  renderToaster(root)

  singleton = { host, root, onFullscreenChange }
}

// Tear down the singleton (for HMR / test cleanup). Not part of the normal
// lifecycle — the page-global toaster lives as long as the document.
export function disposeToasterHost(): void {
  if (!singleton) {
    return
  }
  document.removeEventListener('fullscreenchange', singleton.onFullscreenChange)
  singleton.root.unmount()
  singleton.host.remove()
  singleton = undefined
}
