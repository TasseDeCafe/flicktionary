'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { useIsMobile } from '../hooks/use-is-mobile'

export type FloatingSheetAnchor = HTMLElement | DOMRect | null

interface FloatingSheetContextValue {
  open: boolean
  isMobile: boolean
  expandable: boolean
  expanded: boolean
  setExpanded: (expanded: boolean) => void
  closeSheet: () => void
  contentRef: React.RefObject<HTMLDivElement | null>
  modal: boolean
  portalContainer: HTMLElement | null
  // The element / rect the trigger lives at. Desktop uses it for popover
  // anchoring; mobile drawers stay docked to the bottom.
  anchor: FloatingSheetAnchor
  // CSS selector for outside-pointerdown targets that should NOT dismiss the
  // sheet (the consumer updates the open sheet in place instead). The reader
  // passes its word / highlight spans so tapping a new word swaps the sheet's
  // content without a close/reopen flash.
  ignoreOutsidePointerDownSelector?: string
}

const FloatingSheetContext = React.createContext<FloatingSheetContextValue | null>(null)

const useFloatingSheetContext = () => {
  const ctx = React.useContext(FloatingSheetContext)
  if (!ctx) throw new Error('FloatingSheet children must be rendered inside a <FloatingSheet>')
  return ctx
}

export const useFloatingSheetClose = () => useFloatingSheetContext().closeSheet

interface FloatingSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor?: FloatingSheetAnchor
  expandable?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  modal?: boolean
  closeOnScroll?: boolean
  portalContainer?: HTMLElement | null
  desktopOnly?: boolean
  ignoreOutsidePointerDownSelector?: string
  children: React.ReactNode
}

export const FloatingSheet = ({
  open,
  onOpenChange,
  anchor = null,
  expandable = false,
  expanded: expandedProp,
  onExpandedChange,
  modal = true,
  closeOnScroll = false,
  portalContainer = null,
  desktopOnly = false,
  ignoreOutsidePointerDownSelector,
  children,
}: FloatingSheetProps) => {
  const responsiveIsMobile = useIsMobile()
  const isMobile = desktopOnly ? false : responsiveIsMobile

  const [localExpanded, setLocalExpanded] = React.useState(false)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const expanded = expandedProp ?? localExpanded
  const setExpanded = React.useCallback(
    (next: boolean) => {
      if (onExpandedChange) onExpandedChange(next)
      else setLocalExpanded(next)
    },
    [onExpandedChange]
  )

  // Reset to collapsed whenever the sheet closes so the next open starts fresh.
  React.useEffect(() => {
    if (!open && expandedProp === undefined) setLocalExpanded(false)
  }, [open, expandedProp])

  // Blur the trigger element on open so Radix can safely aria-hide the page
  // content without retaining focus on a now-hidden ancestor. The dialog /
  // popover then auto-focuses its own content as usual. useLayoutEffect runs
  // before Radix's aria-hide effects in the bottom-up effect order.
  React.useLayoutEffect(() => {
    if (!open) return
    if (typeof document === 'undefined') return
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) active.blur()
  }, [open])

  const closeSheet = React.useCallback(() => onOpenChange(false), [onOpenChange])

  React.useEffect(() => {
    if (!open || !closeOnScroll) return
    const handleScroll = (event: Event) => {
      // Scrolling INSIDE the sheet (its own overflow-y-auto body) must not
      // dismiss it — only a scroll of the content behind it counts as "look away".
      const content = contentRef.current
      if (content && event.target instanceof Node && content.contains(event.target)) return
      onOpenChange(false)
    }
    // Runs on mobile too, not just the desktop popover. Mobile's other dismissal
    // path (outside pointerdown) deliberately ignores taps on the reader's word /
    // highlight spans so tapping a new word swaps the sheet in place — but that
    // same exclusion means a *scroll* that starts on a word never fires that
    // path. Listening to the real scroll event closes the sheet regardless of
    // where the gesture began (a tap-to-swap produces no scroll, so it's unaffected).
    document.addEventListener('scroll', handleScroll, { capture: true })
    return () => document.removeEventListener('scroll', handleScroll, { capture: true })
  }, [open, isMobile, closeOnScroll, onOpenChange])

  React.useEffect(() => {
    if (!open || !isMobile || modal) return
    const handleOutsideStart = (event: Event) => {
      // Right-click is never a dismiss intent: the readers bind it as the
      // save/remove toggle and expect the open sheet to survive and morph.
      if (event instanceof PointerEvent && event.button === 2) return
      const content = contentRef.current
      if (!content) return
      if (event.target instanceof Node && content.contains(event.target)) return
      // Taps on the consumer's "persistent" targets (the reader's word /
      // highlight spans) update the open sheet in place instead of dismissing it.
      if (
        ignoreOutsidePointerDownSelector &&
        event.target instanceof Element &&
        event.target.closest(ignoreOutsidePointerDownSelector)
      )
        return
      onOpenChange(false)
    }
    document.addEventListener('pointerdown', handleOutsideStart, { capture: true })
    document.addEventListener('touchstart', handleOutsideStart, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', handleOutsideStart, { capture: true })
      document.removeEventListener('touchstart', handleOutsideStart, { capture: true })
    }
  }, [open, isMobile, modal, onOpenChange, ignoreOutsidePointerDownSelector])

  const ctx: FloatingSheetContextValue = {
    open,
    isMobile,
    expandable,
    expanded,
    setExpanded,
    closeSheet,
    contentRef,
    modal,
    portalContainer,
    anchor,
    ignoreOutsidePointerDownSelector,
  }

  // Both mobile variants render through FloatingSheetContent: the modal one
  // wraps itself in a Radix Dialog there, the non-modal one is a bare portal.
  // The slide animation and drag-to-dismiss live in the content for both.
  if (isMobile) {
    return <FloatingSheetContext.Provider value={ctx}>{children}</FloatingSheetContext.Provider>
  }

  return (
    <FloatingSheetContext.Provider value={ctx}>
      <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DesktopAnchor anchor={anchor} />
        {children}
      </PopoverPrimitive.Root>
    </FloatingSheetContext.Provider>
  )
}

const rectFromAnchor = (anchor: FloatingSheetAnchor): DOMRect | null => {
  if (!anchor) return null
  if (anchor instanceof Element) return anchor.getBoundingClientRect()
  return anchor
}

// Shared motion timing for enter / exit / drag spring-back. We drive the motion
// with a CSS *transition* (not a keyframe animation) so the inline transform we
// set while dragging composes with it instead of being overridden.
const SHEET_DURATION_MS = 240
const SHEET_TRANSITION = `transform ${SHEET_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1), max-height ${SHEET_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`
// Release-snap easing. The drag drives `height` (and `transform` for the
// dismiss translate) directly, so the snap animates those two.
const SHEET_SNAP_TRANSITION = `height ${SHEET_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1), transform ${SHEET_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`
const MOBILE_SHEET_COLLAPSED_MAX_HEIGHT = 'min(34rem, 35dvh)'
const MOBILE_SHEET_EXPANDED_MAX_HEIGHT = '96dvh'
const MOBILE_SHEET_DEFAULT_MAX_HEIGHT = '85dvh'
// Collapsed, an expandable sheet shows its header in full plus this short slice
// of the detail region below it — a deliberate half-row "peek" so the grabber
// and a partially-visible control signal "drag up for more", instead of a fade
// that implies a scroll the collapsed sheet doesn't have.
const MOBILE_SHEET_PEEK_HEIGHT = '3.5rem'
const MOBILE_SHEET_PEEK_PX = 56 // ≈ 3.5rem; collapsed peek used when a drag starts already expanded
const MOBILE_SHEET_EXPANDED_VIEWPORT_RATIO = 0.96 // matches MOBILE_SHEET_EXPANDED_MAX_HEIGHT (96dvh)
const SHEET_OVERDRAG_RUBBER = 0.5 // resistance applied to dragging past the expanded cap
const MOBILE_SHEET_DRAG_Y = '--floating-sheet-drag-y'

type MobileSheetStyle = React.CSSProperties & {
  [MOBILE_SHEET_DRAG_Y]?: string
}

const setSheetDragY = (el: HTMLElement, value: string) => {
  el.style.setProperty(MOBILE_SHEET_DRAG_Y, value)
}

// Mounts/unmounts the mobile sheet around an open/close animation, replacing the
// enter/exit that vaul used to give us. `rendered` stays true through the exit
// animation so the sheet can animate out before it leaves the DOM. All transform
// writes are imperative (on contentRef) so they never fight React's style prop.
//
// The sheet always docks at the bottom: enter slides up, exit slides back down
// to the edge (from wherever it sits — resting or mid-drag).
const useBottomSheetMotion = (open: boolean, isMobile: boolean, contentRef: React.RefObject<HTMLDivElement | null>) => {
  const [rendered, setRendered] = React.useState(open)

  // Mount the moment we open — during render, not in an effect. This re-renders
  // before the commit, so contentRef is populated before the sibling layout
  // effects run on this same commit. Mounting in an effect instead lands a tick
  // late and those effects measure a not-yet-rendered sheet.
  if (isMobile && open && !rendered) setRendered(true)

  // Enter: pin off-screen, then transition up to the resting position. The
  // start position is committed before paint, so there's no flash at y=0.
  React.useLayoutEffect(() => {
    if (!isMobile || !open || !rendered) return
    const el = contentRef.current
    if (!el) return
    el.style.transition = 'none'
    setSheetDragY(el, '100%')
    void el.offsetHeight // force reflow so the next change actually transitions
    el.style.transition = SHEET_TRANSITION
    setSheetDragY(el, '0px')
  }, [isMobile, open, rendered, contentRef])

  // Exit: slide down from wherever it is (resting, or mid-drag) to the edge,
  // then unmount.
  React.useEffect(() => {
    if (!isMobile || open || !rendered) return
    const el = contentRef.current
    if (!el) {
      setRendered(false)
      return
    }
    el.style.transition = SHEET_TRANSITION
    setSheetDragY(el, '100%')
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      setRendered(false)
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target !== el) return
      if (event.propertyName === 'transform') finish()
    }
    el.addEventListener('transitionend', onEnd)
    // Safety net: if transitionend never fires (interrupted, tab hidden) we
    // still unmount so the sheet can't get stuck on screen.
    const timer = window.setTimeout(finish, SHEET_DURATION_MS + 80)
    return () => {
      el.removeEventListener('transitionend', onEnd)
      window.clearTimeout(timer)
    }
  }, [isMobile, open, rendered, contentRef])

  return isMobile ? rendered : open
}

// Finger-following sheet drag, shared by the handle and the (always
// non-scrollable) header so the sheet can be dragged from a large, safe area
// without competing with content scrolling.
//
// Expandable sheets drive the container `height` directly so the sheet grows
// and shrinks under the finger between the collapsed and expanded detents, with
// rubber-banding past the expanded cap. Dragging below the collapsed height
// switches to a downward `transform` translate (the dismiss preview). On
// release we snap (animated) to the nearest detent — dismiss / collapse /
// expand — by final position and flick velocity, then hand the resting layout
// back to React. Non-expandable sheets keep the simple translate-to-dismiss.
const DRAG_DISMISS_DISTANCE = 80 // px past the collapsed edge at which release dismisses
const DRAG_VELOCITY = 0.5 // px/ms — a fast flick wins regardless of distance

type SheetDragState = {
  active: boolean
  startY: number
  lastY: number
  lastT: number
  velocity: number
  startHeight: number
  collapsedPx: number
  expandedPx: number
  canExpand: boolean
  overDismiss: number // px dragged below the collapsed edge (the dismiss preview)
}

const useSheetDragGesture = (
  contentRef: React.RefObject<HTMLDivElement | null>,
  scrollAreaRef: React.RefObject<HTMLDivElement | null>,
  onDismiss: () => void,
  expand: { expandable: boolean; expanded: boolean; setExpanded: (next: boolean) => void }
) => {
  const drag = React.useRef<SheetDragState>({
    active: false,
    startY: 0,
    lastY: 0,
    lastT: 0,
    velocity: 0,
    startHeight: 0,
    collapsedPx: 0,
    expandedPx: 0,
    canExpand: false,
    overDismiss: 0,
  })

  const onPointerDown = (event: React.PointerEvent) => {
    // Right-click is the save/remove toggle, never a drag.
    if (event.button === 2) return
    const el = contentRef.current
    if (!el) return

    // The container is always `chrome (handle + header + footer) + scroller`, so
    // chrome height is derivable in any state. `scrollHeight` is the FULL content
    // height even while the scroller is clipped, so we know the expanded target
    // without un-clipping first.
    const scroller = scrollAreaRef.current
    const chrome = scroller ? el.offsetHeight - scroller.offsetHeight : 0
    const fullContent = scroller ? scroller.scrollHeight : 0
    const collapsedPx = expand.expanded ? chrome + MOBILE_SHEET_PEEK_PX : el.offsetHeight
    const expandedPx = Math.min(window.innerHeight * MOBILE_SHEET_EXPANDED_VIEWPORT_RATIO, chrome + fullContent)
    const canExpand = expand.expandable && expandedPx > collapsedPx + 8

    drag.current = {
      active: true,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
      startHeight: el.offsetHeight,
      collapsedPx,
      expandedPx,
      canExpand,
      overDismiss: 0,
    }
    el.style.transition = 'none'
    if (expand.expandable) {
      // Freeze the current height and let the scroller flex to fill it, so the
      // revealed content tracks the height as we drag. Lifting the container's
      // collapsed max-height cap is essential — otherwise dragging UP can't grow
      // the sheet past it (max-height would clamp the height we set).
      el.style.height = `${el.offsetHeight}px`
      el.style.maxHeight = 'none'
      if (scroller) {
        scroller.style.maxHeight = 'none'
        scroller.style.flex = '1 1 0%'
        scroller.style.overflowY = 'hidden'
      }
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const s = drag.current
    if (!s.active) return
    const el = contentRef.current
    if (!el) return

    const dt = event.timeStamp - s.lastT
    if (dt > 0) s.velocity = (event.clientY - s.lastY) / dt
    s.lastY = event.clientY
    s.lastT = event.timeStamp

    const dy = event.clientY - s.startY // negative = up, positive = down

    if (!expand.expandable) {
      setSheetDragY(el, `${Math.max(0, dy)}px`) // dismiss-only: follow downward, resist upward
      return
    }

    const target = s.startHeight - dy // drag up (dy < 0) grows the sheet
    if (target >= s.collapsedPx) {
      s.overDismiss = 0
      setSheetDragY(el, '0px')
      const cap = s.canExpand ? s.expandedPx : s.collapsedPx
      const h = target > cap ? cap + (target - cap) * SHEET_OVERDRAG_RUBBER : target
      el.style.height = `${h}px`
    } else {
      // Below the collapsed edge → freeze height, translate down (dismiss preview).
      el.style.height = `${s.collapsedPx}px`
      s.overDismiss = s.collapsedPx - target
      setSheetDragY(el, `${s.overDismiss}px`)
    }
  }

  const onPointerEnd = () => {
    const s = drag.current
    if (!s.active) return
    s.active = false
    const el = contentRef.current
    if (!el) return
    const scroller = scrollAreaRef.current
    const fastDown = s.velocity > DRAG_VELOCITY
    const fastUp = s.velocity < -DRAG_VELOCITY

    if (!expand.expandable) {
      const draggedDown = s.lastY - s.startY
      el.style.transition = SHEET_TRANSITION
      if (draggedDown > DRAG_DISMISS_DISTANCE || fastDown) onDismiss()
      else setSheetDragY(el, '0px') // spring back to rest
      return
    }

    // Decide the detent.
    let decision: 'dismiss' | 'collapse' | 'expand'
    if (s.overDismiss > 0) {
      decision = s.overDismiss > DRAG_DISMISS_DISTANCE || fastDown ? 'dismiss' : 'collapse'
    } else if (s.canExpand && fastUp) {
      decision = 'expand'
    } else if (fastDown) {
      decision = 'collapse'
    } else if (s.canExpand) {
      const mid = (s.collapsedPx + s.expandedPx) / 2
      decision = el.offsetHeight >= mid ? 'expand' : 'collapse'
    } else {
      decision = 'collapse'
    }

    if (decision === 'dismiss') {
      el.style.transition = SHEET_TRANSITION
      onDismiss() // the exit effect translates the rest of the way down and unmounts
      return
    }

    const willExpand = decision === 'expand'
    const targetPx = willExpand ? s.expandedPx : s.collapsedPx
    el.style.transition = SHEET_SNAP_TRANSITION
    setSheetDragY(el, '0px')
    el.style.height = `${targetPx}px`

    // On snap-end, write the resting inline styles for the chosen detent
    // EXPLICITLY rather than clearing and relying on a React re-render: collapsing
    // an already-collapsed sheet doesn't change `expanded`, so React wouldn't
    // reassert the clip and the unclipped content would flash through. These
    // values match exactly what the JSX renders for the detent (container
    // max-height, scroller clip/scroll), so the next React render is a no-op diff.
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      el.removeEventListener('transitionend', onEnd)
      window.clearTimeout(timer)
      expand.setExpanded(willExpand)
      el.style.height = ''
      el.style.maxHeight = willExpand ? MOBILE_SHEET_EXPANDED_MAX_HEIGHT : MOBILE_SHEET_COLLAPSED_MAX_HEIGHT
      if (scroller) {
        // flex / overflow live on the className per detent — clearing the inline
        // overrides hands them back to it. max-height is React-managed only while
        // collapsed, so set it for the collapsed rest and clear it for expanded.
        scroller.style.flex = ''
        scroller.style.overflowY = ''
        scroller.style.maxHeight = willExpand ? '' : MOBILE_SHEET_PEEK_HEIGHT
      }
    }
    // Any transition on the container itself (height for expand/collapse-with-
    // resize, transform for a collapsed spring-back) marks the snap done.
    const onEnd = (ev: TransitionEvent) => {
      if (ev.target === el) settle()
    }
    el.addEventListener('transitionend', onEnd)
    const timer = window.setTimeout(settle, SHEET_DURATION_MS + 80)
  }

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd }
}

// Invisible 0-effect element at the anchor rect's position so Radix Popover has
// something concrete to position against. Re-measures every render in case the
// underlying element moved (scroll inside the modal screen, layout reflow).
const DesktopAnchor = ({ anchor }: { anchor: FloatingSheetAnchor }) => {
  const rect = rectFromAnchor(anchor)
  if (!rect) return null
  return (
    <PopoverPrimitive.Anchor asChild>
      <span
        aria-hidden
        style={{
          position: 'fixed',
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          pointerEvents: 'none',
        }}
      />
    </PopoverPrimitive.Anchor>
  )
}

// Radix dismissal filter shared by the desktop popover and the modal mobile
// dialog. Cancels Radix's close for two cases: a right-button pointerdown
// outside (readers bind right-click as the save/remove toggle and expect the
// open sheet to survive and morph), and a pointerdown on a consumer-declared
// "persistent" target (the reader's word / highlight spans, which update the
// open sheet in place instead of dismissing it).
const makeIgnoreOutsidePointerDown =
  (ignoreSelector?: string) => (event: { detail: { originalEvent: Event }; preventDefault: () => void }) => {
    const original = event.detail.originalEvent
    if (original instanceof PointerEvent && original.button === 2) {
      event.preventDefault()
      return
    }
    if (ignoreSelector && original.target instanceof Element && original.target.closest(ignoreSelector)) {
      event.preventDefault()
    }
  }

type ScrollAffordanceMetrics = {
  overflowing: boolean
  trackHeight: number
  thumbHeight: number
  thumbOffset: number
  bottomInset: number
}

const emptyScrollAffordanceMetrics: ScrollAffordanceMetrics = {
  overflowing: false,
  trackHeight: 0,
  thumbHeight: 0,
  thumbOffset: 0,
  bottomInset: 0,
}

const scrollAffordanceMetricsEqual = (a: ScrollAffordanceMetrics, b: ScrollAffordanceMetrics) =>
  a.overflowing === b.overflowing &&
  a.trackHeight === b.trackHeight &&
  a.thumbHeight === b.thumbHeight &&
  a.thumbOffset === b.thumbOffset &&
  a.bottomInset === b.bottomInset

const FLOATING_SHEET_STICKY_FOOTER_ATTR = 'data-floating-sheet-sticky-footer'

const measureStickyFooterInset = (el: HTMLElement) => {
  const footer = el.querySelector<HTMLElement>(`[${FLOATING_SHEET_STICKY_FOOTER_ATTR}]`)
  if (!footer) return 0
  if (window.getComputedStyle(footer).position !== 'sticky') return 0
  return Math.min(Math.max(0, el.clientHeight - 24), Math.ceil(footer.getBoundingClientRect().height))
}

const measureScrollAffordance = (el: HTMLElement): ScrollAffordanceMetrics => {
  const clientHeight = el.clientHeight
  const scrollHeight = el.scrollHeight
  if (scrollHeight <= clientHeight + 1) return emptyScrollAffordanceMetrics

  const bottomInset = measureStickyFooterInset(el)
  const visibleScrollAreaHeight = Math.max(1, clientHeight - bottomInset)
  const trackHeight = Math.max(24, visibleScrollAreaHeight - 16)
  const thumbHeight = Math.max(24, Math.round((trackHeight * visibleScrollAreaHeight) / scrollHeight))
  const maxScroll = Math.max(1, scrollHeight - clientHeight)
  const thumbOffset = Math.round((trackHeight - thumbHeight) * (el.scrollTop / maxScroll))

  return { overflowing: true, trackHeight, thumbHeight, thumbOffset, bottomInset }
}

const useScrollAffordanceMetrics = (
  enabled: boolean,
  contentRef: React.RefObject<HTMLDivElement | null>
): { metrics: ScrollAffordanceMetrics; onScroll: () => void } => {
  const [metrics, setMetrics] = React.useState<ScrollAffordanceMetrics>(emptyScrollAffordanceMetrics)
  const frameRef = React.useRef(0)

  const update = React.useCallback(() => {
    const el = contentRef.current
    const next = enabled && el ? measureScrollAffordance(el) : emptyScrollAffordanceMetrics
    setMetrics((prev) => (scrollAffordanceMetricsEqual(prev, next) ? prev : next))
  }, [contentRef, enabled])

  // rAF-throttled re-measure. Driven by the scroller's `onScroll` (bound
  // declaratively in JSX — see below), resize, and content-size mutations.
  const scheduleUpdate = React.useCallback(() => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = window.requestAnimationFrame(update)
  }, [update])

  React.useLayoutEffect(() => {
    update()
  })

  React.useEffect(() => {
    const el = contentRef.current
    if (!enabled || !el) return

    // The scroll position itself is tracked via React's onScroll on the element
    // (reliable regardless of when Radix mounts the content); these observers
    // only catch size changes (viewport resize, content growth) that move the
    // overflow boundary.
    window.addEventListener('resize', scheduleUpdate)
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleUpdate) : null
    resizeObserver?.observe(el)
    const mutationObserver = new MutationObserver(scheduleUpdate)
    mutationObserver.observe(el, { childList: true, subtree: true, characterData: true })

    scheduleUpdate()
    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', scheduleUpdate)
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
    }
  }, [contentRef, enabled, scheduleUpdate])

  return { metrics, onScroll: scheduleUpdate }
}

const FloatingSheetScrollAffordance = ({ metrics }: { metrics: ScrollAffordanceMetrics }) => {
  if (!metrics.overflowing) return null
  return (
    <div aria-hidden className='pointer-events-none sticky top-0 z-10 h-0'>
      <div
        className='bg-muted-foreground/20 absolute top-2 -right-1.5 w-1 rounded-full'
        style={{ height: `${metrics.trackHeight}px` }}
      >
        <div
          className='bg-muted-foreground/65 absolute left-0 w-full rounded-full'
          style={{
            height: `${metrics.thumbHeight}px`,
            transform: `translateY(${metrics.thumbOffset}px)`,
          }}
        />
      </div>
    </div>
  )
}

interface FloatingSheetFooterProps {
  className?: string
  children: React.ReactNode
}

export const FloatingSheetFooter = ({ className, children }: FloatingSheetFooterProps) => {
  const { isMobile, expandable, expanded } = useFloatingSheetContext()

  // Mobile: a distinct pinned action bar. The soft upward shadow makes the
  // peeking content above read as tucking UNDER the bar — only meaningful while
  // collapsed; once expanded the content scrolls cleanly, so drop the shadow and
  // let the top border alone separate the bar.
  const showFooterShadow = isMobile && expandable && !expanded

  return (
    <div
      data-floating-sheet-sticky-footer=''
      className={cn(
        isMobile
          ? 'bg-background relative z-10 flex shrink-0 flex-col gap-2 border-t px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
          : 'bg-popover sticky bottom-0 z-10 mt-auto flex flex-col gap-2 px-2 pt-3 pb-3',
        showFooterShadow && 'shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.18)]',
        className
      )}
    >
      {children}
    </div>
  )
}

type FloatingSheetContentProps = React.HTMLAttributes<HTMLDivElement> & {
  disableAnimation?: boolean
  visualScrollAffordance?: boolean
  // Desktop popover width (Tailwind class). Defaults to `w-80`. Only applies to
  // the desktop popover branch — the mobile drawer is always full-width
  // (`inset-x-0`), so a width class here would break it.
  desktopWidthClassName?: string
}

export const FloatingSheetContent = ({
  className,
  children,
  disableAnimation = false,
  visualScrollAffordance = false,
  desktopWidthClassName = 'w-80',
  style,
  ...props
}: FloatingSheetContentProps) => {
  const {
    open,
    isMobile,
    expandable,
    expanded,
    setExpanded,
    contentRef,
    modal,
    portalContainer,
    closeSheet,
    ignoreOutsidePointerDownSelector,
  } = useFloatingSheetContext()
  const ignoreOutsidePointerDown = React.useMemo(
    () => makeIgnoreOutsidePointerDown(ignoreOutsidePointerDownSelector),
    [ignoreOutsidePointerDownSelector]
  )
  const mobileScrollAreaRef = React.useRef<HTMLDivElement | null>(null)
  const rendered = useBottomSheetMotion(open, isMobile, contentRef)
  const dragHandleProps = useSheetDragGesture(contentRef, mobileScrollAreaRef, closeSheet, {
    expandable,
    expanded,
    setExpanded,
  })
  const { metrics: scrollMetrics, onScroll: onScrollAffordance } = useScrollAffordanceMetrics(
    visualScrollAffordance && !isMobile,
    contentRef
  )
  const mobileMaxHeight = expandable
    ? expanded
      ? MOBILE_SHEET_EXPANDED_MAX_HEIGHT
      : MOBILE_SHEET_COLLAPSED_MAX_HEIGHT
    : MOBILE_SHEET_DEFAULT_MAX_HEIGHT
  const mobileScrollEnabled = !expandable || expanded

  React.useLayoutEffect(() => {
    if (!isMobile || expanded) return
    const el = mobileScrollAreaRef.current
    if (el) el.scrollTop = 0
  }, [isMobile, expanded])

  if (isMobile) {
    if (!rendered) return null

    const mobileChildren = React.Children.toArray(children)
    const mobileFooterChildren = mobileChildren.filter(
      (child) => React.isValidElement(child) && child.type === FloatingSheetFooter
    )
    const mobileNonFooterChildren = mobileChildren.filter(
      (child) => !(React.isValidElement(child) && child.type === FloatingSheetFooter)
    )
    const hasMobileFooter = mobileFooterChildren.length > 0

    // Expandable sheets pin the header as an always-visible summary and treat
    // everything below it as detail. Collapsed, that detail region is clipped to
    // a short PEEK (the grabber + a half-row are the "drag up for more" signal).
    // Non-expandable sheets keep one scrolling body with the header inside it.
    const mobileHeaderChildren = expandable
      ? mobileNonFooterChildren.filter(
          (child) => React.isValidElement(child) && child.type === FloatingSheetHeader
        )
      : []
    const mobileDetailChildren = expandable
      ? mobileNonFooterChildren.filter(
          (child) => !(React.isValidElement(child) && child.type === FloatingSheetHeader)
        )
      : mobileNonFooterChildren

    const contentClassName = cn(
      'group/floating-sheet bg-background fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-lg border-t shadow-xl outline-none will-change-transform',
      className
    )
    const mobileSheetStyle: MobileSheetStyle = {
      ...style,
      maxHeight: mobileMaxHeight,
      transform: `translateY(var(${MOBILE_SHEET_DRAG_Y}, 0px))`,
    }

    const inner = (
      <>
        {/* Drag handle + header are both drag surfaces (the header is always
            non-scrollable, so it never competes with content scrolling).
            `touch-none` keeps the browser from turning the gesture into a page
            scroll; `select-none` stops the header text from selecting mid-drag. */}
        <div
          {...dragHandleProps}
          className='flex shrink-0 cursor-grab touch-none justify-center pt-3 pb-4 active:cursor-grabbing'
        >
          <div className='bg-muted h-1.5 w-12 rounded-full' />
        </div>
        {mobileHeaderChildren.length > 0 && (
          <div
            {...dragHandleProps}
            className='shrink-0 cursor-grab touch-none select-none px-4 active:cursor-grabbing'
          >
            {mobileHeaderChildren}
          </div>
        )}
        <div
          ref={mobileScrollAreaRef}
          className={cn(
            'flex min-h-0 flex-col overscroll-none px-4',
            hasMobileFooter ? 'pb-0' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
            mobileScrollEnabled ? 'flex-1 overflow-y-auto' : 'overflow-hidden'
          )}
          style={expandable && !expanded ? { maxHeight: MOBILE_SHEET_PEEK_HEIGHT } : undefined}
        >
          {mobileDetailChildren}
        </div>
        {mobileFooterChildren}
      </>
    )

    if (!modal) {
      if (typeof document === 'undefined') return null
      return createPortal(
        <div ref={contentRef} className={contentClassName} style={mobileSheetStyle} {...props}>
          {inner}
        </div>,
        portalContainer ?? document.body
      )
    }

    return (
      // Kept open through the exit animation (rendered stays true until the
      // slide-out finishes); a Radix-initiated close (escape / outside tap)
      // routes through closeSheet so the same animation plays.
      <DialogPrimitive.Root open modal onOpenChange={(next) => !next && closeSheet()}>
        <DialogPrimitive.Portal container={portalContainer ?? undefined}>
          {/* Transparent overlay — captures outside taps as a dismiss intent
              without tinting the source content. */}
          <DialogPrimitive.Overlay className='fixed inset-0 z-40 bg-transparent' />
          <DialogPrimitive.Content
            ref={contentRef}
            // Our sheets show the relevant info visibly in the header/body, so
            // we opt out of Radix's <Description> requirement via the
            // documented `aria-describedby={undefined}` escape hatch.
            aria-describedby={undefined}
            onPointerDownOutside={ignoreOutsidePointerDown}
            className={contentClassName}
            style={mobileSheetStyle}
            {...props}
          >
            {inner}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    )
  }

  return (
    <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
      {/* Thin outer box: the opaque background, rounded border and shadow, and
          it CLIPS (`overflow-hidden`). It shrink-wraps the inner scroller, whose
          own `max-height` owns the cap + the scroll (the proven
          max-height + overflow-y-auto pattern). The only job of this wrapper is
          to clip an overscroll bounce / any stray overflow so it can never paint
          past the rounded border (the bleed bug) — and its bg backs the bounce
          so the gap is never see-through. */}
      <PopoverPrimitive.Content
        side='bottom'
        align='start'
        sideOffset={6}
        collisionPadding={12}
        onPointerDownOutside={ignoreOutsidePointerDown}
        className={cn(
          'bg-popover text-popover-foreground z-50 origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-md border shadow-xl outline-hidden',
          desktopWidthClassName,
          !disableAnimation &&
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className
        )}
        style={style}
        {...props}
      >
        {/* Inner scroller owns the height cap + scroll. `scrollbar-affordance`
            (tokens.css) styles a persistent native scrollbar; `visualScrollAffordance`
            hides it in favor of the overlaid custom bar (shadow-DOM surfaces,
            where native scrollbar styling is unreliable).

            max-height / overflow-y / overscroll-behavior are set INLINE, not via
            utility classes, on purpose: in the web app's Tailwind build the
            `overflow-y-*` utility did not reliably land on this element (it
            computed `overflow-y: visible`, so the scroller was capped but couldn't
            scroll). Inline values can't be dropped by tailwind-merge or shadowed
            in the cascade, so the scroll is guaranteed on every surface. */}
        <div
          ref={contentRef}
          onScroll={onScrollAffordance}
          data-overflowing={scrollMetrics.overflowing ? '' : undefined}
          className={cn(
            'scrollbar-affordance px-2 py-0',
            visualScrollAffordance && '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          )}
          style={{
            maxHeight: 'min(var(--radix-popover-content-available-height, calc(100vh - 24px)), calc(100vh - 24px))',
            overflowY: 'auto',
            overscrollBehavior: 'none',
          }}
        >
          {visualScrollAffordance && <FloatingSheetScrollAffordance metrics={scrollMetrics} />}
          {children}
        </div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

interface FloatingSheetHeaderProps {
  className?: string
  children: React.ReactNode
}

export const FloatingSheetHeader = ({ className, children }: FloatingSheetHeaderProps) => (
  <div className={cn('flex flex-col gap-1 px-2 pt-3 pb-2', className)}>{children}</div>
)

interface FloatingSheetTitleProps {
  className?: string
  children: React.ReactNode
}

export const FloatingSheetTitle = ({ className, children }: FloatingSheetTitleProps) => {
  const { isMobile, modal } = useFloatingSheetContext()
  if (isMobile && modal) {
    return (
      <DialogPrimitive.Title className={cn('text-foreground text-base font-semibold', className)}>
        {children}
      </DialogPrimitive.Title>
    )
  }
  return <h2 className={cn('text-foreground text-base font-semibold', className)}>{children}</h2>
}

interface FloatingSheetDescriptionProps {
  className?: string
  children?: React.ReactNode
}

export const FloatingSheetDescription = ({ className, children }: FloatingSheetDescriptionProps) => {
  // Null-tolerant on purpose: GlossCardBody renders this, and the extension's
  // video-overlay popovers can render GlossCardBody outside a modal sheet.
  // Without a modal sheet there is no Radix Dialog to describe, so the plain
  // <p> branch is always correct there.
  const ctx = React.useContext(FloatingSheetContext)
  if (ctx?.isMobile && ctx.modal) {
    return (
      <DialogPrimitive.Description className={cn('text-muted-foreground text-sm', className)}>
        {children}
      </DialogPrimitive.Description>
    )
  }
  return <p className={cn('text-muted-foreground text-sm', className)}>{children}</p>
}

interface FloatingSheetBodyProps {
  className?: string
  children: React.ReactNode
}

export const FloatingSheetBody = ({ className, children }: FloatingSheetBodyProps) => (
  <div className={cn('flex flex-col gap-2 px-2 pb-2 text-sm', className)}>{children}</div>
)
