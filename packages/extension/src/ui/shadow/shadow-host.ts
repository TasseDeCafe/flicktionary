import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { overlaySheet } from './overlay-stylesheet'
import { MAX_Z_INDEX, YOUTUBE_OVERLAY_Z_INDEX } from '@/constants'
import { isYoutubeHost } from '@/services/flicktionary/youtube-context'

// The render callback receives the shadow root (for the emotion cache) and the
// portal container element inside it (for MUI portals) — exactly the two props
// ShadowMuiProvider needs.
export interface ShadowMountContext {
  shadowRoot: ShadowRoot
  portalContainer: HTMLElement
}

export interface ShadowHostHandle {
  host: HTMLElement
  shadowRoot: ShadowRoot
  unmount(): void
}

interface BaseShadowHostOptions {
  // Marker attribute so a host stranded by a previous content-script load / HMR
  // can be found and removed before mounting a fresh one.
  hostAttribute: string
  // Adopt the shared Tailwind sheet into the shadow root (opt-in; MUI surfaces
  // rely on emotion + CssBaseline instead and can skip it).
  adoptTailwind?: boolean
  render: (ctx: ShadowMountContext) => ReactNode
}

// Low-level: build a `<div>` host carrying its own shadow root with two
// children — `appRoot` (the React root) and `portalContainer` (MUI portal
// target). Critically the host carries NO CSS transform, so `position:fixed`
// MUI popovers/dialogs inside it resolve against the viewport (the transform
// trap that rules out reusing the subtitle CachingElementOverlay container).
//
// The caller is responsible for placing `host` in the DOM and positioning it.
function createShadowHost(options: BaseShadowHostOptions): {
  host: HTMLElement
  shadowRoot: ShadowRoot
  appRoot: HTMLElement
  portalContainer: HTMLElement
  root: Root
} {
  document.querySelectorAll(`[${options.hostAttribute}]`).forEach((el) => el.remove())

  const host = document.createElement('div')
  host.setAttribute(options.hostAttribute, '')

  const shadowRoot = host.attachShadow({ mode: 'open' })
  if (options.adoptTailwind) {
    shadowRoot.adoptedStyleSheets = [overlaySheet()]
  }

  const appRoot = document.createElement('div')
  const portalContainer = document.createElement('div')
  // Hosts are click-through (pointer-events:none) so they don't steal clicks
  // from the page. Portalled MUI content (Popover/Menu/Dialog/Tooltip) lands
  // here and must opt back into pointer events or it can't be interacted with.
  // The container itself has no layout box, so this never blocks the page.
  portalContainer.style.setProperty('pointer-events', 'auto')
  shadowRoot.appendChild(appRoot)
  shadowRoot.appendChild(portalContainer)

  const root = createRoot(appRoot)
  root.render(options.render({ shadowRoot, portalContainer }))

  return { host, shadowRoot, appRoot, portalContainer, root }
}

// Keep a fullscreen-aware host parented under document.fullscreenElement (when
// any element is fullscreen) or document.body otherwise — a `position:fixed`
// element is invisible in fullscreen unless it descends from the fullscreen
// element. Returns a disposer that removes the fullscreenchange listener.
function makeFullscreenAware(host: HTMLElement, onPlace?: () => void): () => void {
  const place = () => {
    const parent = document.fullscreenElement ?? document.body
    if (host.parentElement !== parent) {
      parent.appendChild(host)
    }
    onPlace?.()
  }
  place()
  const onFullscreenChange = () => place()
  document.addEventListener('fullscreenchange', onFullscreenChange)
  return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
}

export interface ModalHostOptions {
  hostAttribute: string
  adoptTailwind?: boolean
  render: (ctx: ShadowMountContext) => ReactNode
}

// A centred, fullscreen-aware modal shadow host. The host fills the viewport
// (`position:fixed; inset:0`) but is itself click-through (`pointer-events:none`)
// — the rendered content (typically a MUI Dialog, which brings its own backdrop,
// focus trap, Escape + click-outside) re-enables pointer-events on its own
// surfaces. Backdrop/focus/escape are therefore owned by the MUI component, not
// reimplemented here.
export function mountModalHost(options: ModalHostOptions): ShadowHostHandle {
  const { host, shadowRoot, appRoot, root } = createShadowHost(options)

  host.style.setProperty('position', 'fixed')
  host.style.setProperty('inset', '0')
  host.style.setProperty('z-index', String(MAX_Z_INDEX))
  host.style.setProperty('pointer-events', 'none')
  // The MUI Dialog (portalled) gets pointer events via portalContainer; a
  // non-portalled, fixed-positioned Snackbar/Alert renders inline under appRoot,
  // so re-enable pointer events here too. appRoot has no layout box of its own
  // (its content is fixed-positioned), so this doesn't block the page.
  appRoot.style.setProperty('pointer-events', 'auto')

  const disposeFullscreen = makeFullscreenAware(host)

  return {
    host,
    shadowRoot,
    unmount() {
      root.unmount()
      disposeFullscreen()
      host.remove()
    },
  }
}

export type VideoOverlayAnchor = 'top' | 'bottom'

export interface VideoOverlayHostOptions {
  hostAttribute: string
  adoptTailwind?: boolean
  video: HTMLMediaElement
  anchor: VideoOverlayAnchor
  // Gap in px between the video edge and the overlay content.
  offset?: number
  render: (ctx: ShadowMountContext) => ReactNode
}

// A fullscreen-aware shadow host positioned OVER a video, replacing the
// CachingElementOverlay + iframe transport for the controls overlay. The host is
// `position:fixed` and sized/placed to the video's bounding box every frame, with
// NO transform (so MUI popovers inside resolve against the viewport). The React
// content is laid out (flex, anchored top/bottom, centred) by the caller's tree;
// the host itself is click-through so it never steals pointer events from the
// player except on the controls themselves.
export function mountVideoOverlayHost(options: VideoOverlayHostOptions): ShadowHostHandle {
  const { video, anchor, offset = 8 } = options
  const { host, shadowRoot, appRoot, root } = createShadowHost(options)

  host.style.setProperty('position', 'fixed')
  // On YouTube, drop below page chrome (search autocomplete etc.) so the overlay
  // doesn't cover it; everywhere else stay at MAX_Z_INDEX (Prime/Netflix players
  // use high-z chrome that would hide a low overlay). See YOUTUBE_OVERLAY_Z_INDEX.
  host.style.setProperty('z-index', String(isYoutubeHost() ? YOUTUBE_OVERLAY_Z_INDEX : MAX_Z_INDEX))
  host.style.setProperty('pointer-events', 'none')

  // Lay out the content inside the video box: full-bleed flex, centred
  // horizontally, anchored to the requested edge. Children opt back into pointer
  // events.
  appRoot.style.setProperty('width', '100%')
  appRoot.style.setProperty('height', '100%')
  appRoot.style.setProperty('display', 'flex')
  appRoot.style.setProperty('justify-content', 'center')
  appRoot.style.setProperty('align-items', anchor === 'bottom' ? 'flex-end' : 'flex-start')
  appRoot.style.setProperty('padding', `${offset}px 0`)
  appRoot.style.setProperty('box-sizing', 'border-box')
  appRoot.style.setProperty('pointer-events', 'none')

  const reposition = () => {
    const rect = video.getBoundingClientRect()
    // No layout box (off-screen, paused in a virtualised feed, detached): hide
    // rather than pin to the top-left.
    if (rect.width === 0 && rect.height === 0) {
      host.style.setProperty('display', 'none')
      return
    }
    host.style.removeProperty('display')
    host.style.setProperty('left', `${rect.left}px`)
    host.style.setProperty('top', `${rect.top}px`)
    host.style.setProperty('width', `${rect.width}px`)
    host.style.setProperty('height', `${rect.height}px`)
  }

  reposition()
  const disposeFullscreen = makeFullscreenAware(host, reposition)
  // Track video movement/resize + page scroll. An interval mirrors the legacy
  // CachingElementOverlay's polling and survives layout shifts no event covers.
  const interval = setInterval(reposition, 250)
  const onScroll = () => reposition()
  const onResize = () => reposition()
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)

  return {
    host,
    shadowRoot,
    unmount() {
      root.unmount()
      clearInterval(interval)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      disposeFullscreen()
      host.remove()
    },
  }
}
