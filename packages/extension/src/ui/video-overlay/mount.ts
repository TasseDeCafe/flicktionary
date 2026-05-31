import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import overlayCss from './overlay.css?inline'
import { SubtitleStore } from './subtitle-store'
import { SubtitleOverlayApp } from './SubtitleOverlayApp'
import { FlicktionaryVideoClosures } from '../../services/flicktionary/flicktionary-client'

const POPOVER_HOST_ATTR = 'data-asbplayer-react-popover-host'

// One adopted stylesheet shared across all overlay shadow roots in this
// document/realm. Tailwind's generated CSS is identical for every Binding, so a
// single read-only CSSStyleSheet is enough — and adoptedStyleSheets can share
// the same object between multiple shadow roots.
let sheetCache: CSSStyleSheet | undefined
const overlaySheet = (): CSSStyleSheet => {
  if (!sheetCache) {
    sheetCache = new CSSStyleSheet()
    sheetCache.replaceSync(overlayCss)
  }
  return sheetCache
}

export interface OverlayMountOptions {
  store: SubtitleStore
  video: HTMLMediaElement
  closures: FlicktionaryVideoClosures
}

export interface OverlayMountHandle {
  unmount(): void
}

// Attach a shadow root + React root to the persistent host (owned by
// ElementOverlay), adopt the Tailwind sheet, and stand up a SEPARATE popover
// shadow host that is reparented to the fullscreen element on fullscreen toggle
// (so position:fixed popovers escape the transformed subtitle container and
// stay visible in fullscreen). Returns a handle whose unmount() tears
// everything down — call it before ElementOverlay.disposePersistentHost().
export function mountSubtitleOverlay(host: HTMLElement, options: OverlayMountOptions): OverlayMountHandle {
  const sheet = overlaySheet()

  // Subtitle shadow tree on the persistent host.
  const subtitleShadow = host.attachShadow({ mode: 'open' })
  subtitleShadow.adoptedStyleSheets = [sheet]
  const subtitleRootEl = document.createElement('div')
  subtitleShadow.appendChild(subtitleRootEl)

  // Remove any popover hosts stranded by a previous script load / HMR.
  document.querySelectorAll(`[${POPOVER_HOST_ATTR}]`).forEach((el) => el.remove())

  // Separate, non-transformed popover shadow host (plan #4). A zero-size div
  // whose fixed-positioned children handle their own pointer-events, so it
  // never blocks the page.
  const popoverHost = document.createElement('div')
  popoverHost.setAttribute(POPOVER_HOST_ATTR, '')
  const popoverShadow = popoverHost.attachShadow({ mode: 'open' })
  popoverShadow.adoptedStyleSheets = [sheet]
  const popoverContainer = document.createElement('div')
  popoverShadow.appendChild(popoverContainer)

  const placePopoverHost = () => {
    const parent = document.fullscreenElement ?? document.body
    if (popoverHost.parentElement !== parent) {
      parent.appendChild(popoverHost)
    }
    options.store.setFullscreen(!!document.fullscreenElement)
  }
  placePopoverHost()
  const onFullscreenChange = () => placePopoverHost()
  document.addEventListener('fullscreenchange', onFullscreenChange)

  const root = createRoot(subtitleRootEl)
  root.render(
    createElement(SubtitleOverlayApp, {
      store: options.store,
      popoverContainer,
      video: options.video,
      closures: options.closures,
    })
  )

  return {
    unmount() {
      root.unmount()
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      popoverHost.remove()
    },
  }
}
