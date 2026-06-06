import { createElement, useEffect } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { Toaster } from 'sonner'
import type { ToasterProps } from 'sonner'
import { resolveTheme } from '@asbplayer-fork/common/settings'
import { applyOverlayStyles } from '../shadow/overlay-stylesheet'

// Mirrors the extension's `themeType` setting. 'system' is resolved here
// (this realm's matchMedia) when the theme is set.
export type ToasterTheme = 'dark' | 'light' | 'system'

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

// Current RESOLVED toaster theme. We pass this to sonner EXPLICITLY rather than
// using its `theme="system"` — we resolve 'system' ourselves in setToasterTheme
// so all theme handling goes through the shared resolveTheme. Defaults to the
// resolved system theme until _refreshSettings pushes the real value.
let currentTheme: 'dark' | 'light' = resolveTheme('system')

// sonner's `toast()` publishes to subscribers only — its <Toaster> subscribes in
// a useEffect and does NOT replay earlier toasts, so anything dispatched in the
// same tick that creates the host (createRoot().render() is async) is silently
// dropped. Queue dispatches until the Toaster has committed: child effects run
// before parent effects, so when this wrapper's effect fires, sonner's
// subscription inside <Toaster> is guaranteed live.
let toasterReady = false
let pendingDispatches: Array<() => void> = []

const ToasterReadyGate = (props: ToasterProps) => {
  useEffect(() => {
    toasterReady = true
    const queued = pendingDispatches
    pendingDispatches = []
    queued.forEach((dispatch) => dispatch())
  }, [])
  return createElement(Toaster, props)
}

// Dispatch a sonner `toast()` call, standing up the host first and deferring
// the call until the Toaster is actually subscribed. All toast call sites must
// go through this — a bare `ensureToasterHost(); toast(...)` loses the first
// toast of the page.
export function dispatchToast(dispatch: () => void): void {
  ensureToasterHost()
  if (toasterReady) {
    dispatch()
  } else {
    pendingDispatches.push(dispatch)
  }
}

// sonner sets `data-sonner-theme` from this prop; the palette for both themes is
// in the adopted stylesheet, so the toaster is colored correctly in the shadow root.
function renderToaster(root: Root): void {
  root.render(
    createElement(ToasterReadyGate, {
      position: 'bottom-right',
      theme: currentTheme,
      style: { zIndex: TOASTER_Z_INDEX },
    })
  )
}

// Follow the extension's themeType (callers pass the raw setting; 'system' is
// resolved here). Re-renders the live toaster if it exists, so a settings
// change recolors toasts without recreating the host.
export function setToasterTheme(theme: ToasterTheme): void {
  const resolved = resolveTheme(theme)
  if (resolved === currentTheme) {
    return
  }
  currentTheme = resolved
  if (singleton) {
    renderToaster(singleton.root)
  }
}

// Stand up the singleton Toaster (idempotent). Don't pair this manually with a
// bare `toast()` — use dispatchToast, which waits for the Toaster to subscribe.
function ensureToasterHost(): void {
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
  applyOverlayStyles(shadow)
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
  toasterReady = false
  pendingDispatches = []
}
