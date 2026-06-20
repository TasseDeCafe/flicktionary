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
  // The element / rect the trigger lives at. On mobile we use it to flip the
  // sheet above the word when the default bottom placement would cover it.
  anchor: FloatingSheetAnchor
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
    if (!open || isMobile !== false || !closeOnScroll) return
    const handleScroll = (event: Event) => {
      // Scrolling INSIDE the popover (its own overflow-y-auto body) must not
      // dismiss it — only a scroll of the page behind it counts as "look away".
      const content = contentRef.current
      if (content && event.target instanceof Node && content.contains(event.target)) return
      onOpenChange(false)
    }
    document.addEventListener('scroll', handleScroll, { capture: true })
    return () => document.removeEventListener('scroll', handleScroll, { capture: true })
  }, [open, isMobile, closeOnScroll, onOpenChange])

  React.useEffect(() => {
    if (!open || isMobile !== true || modal) return
    const handleOutsideStart = (event: Event) => {
      // Right-click is never a dismiss intent: the readers bind it as the
      // save/remove toggle and expect the open sheet to survive and morph.
      if (event instanceof PointerEvent && event.button === 2) return
      const content = contentRef.current
      if (!content) return
      if (event.target instanceof Node && content.contains(event.target)) return
      onOpenChange(false)
    }
    document.addEventListener('pointerdown', handleOutsideStart, { capture: true })
    document.addEventListener('touchstart', handleOutsideStart, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', handleOutsideStart, { capture: true })
      document.removeEventListener('touchstart', handleOutsideStart, { capture: true })
    }
  }, [open, isMobile, modal, onOpenChange])

  if (isMobile === undefined) return null

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
const SHEET_TRANSITION = `transform ${SHEET_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`

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
    el.style.transform = 'translateY(100%)'
    void el.offsetHeight // force reflow so the next change actually transitions
    el.style.transition = SHEET_TRANSITION
    el.style.transform = 'translateY(0)'
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
    el.style.transform = 'translateY(100%)'
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

// Bidirectional drag on the drag handle. We only ever start a drag from the
// handle, so this never competes with scrolling the sheet's own content. The
// finger drives an inline translateY; on release we resolve to one of: dismiss
// (slide-out handed to useBottomSheetMotion), expand, collapse, or spring back.
//
//  - Drag DOWN past the threshold: dismiss (or, if expanded, collapse first).
//  - Drag UP past the threshold (only when expandable & not yet expanded):
//    expand and spring back to rest (the now-taller content fills the space).
const DRAG_DISMISS_DISTANCE = 80 // px dragged down past which we dismiss on release
const DRAG_EXPAND_DISTANCE = 40 // px dragged up past which we expand on release
const DRAG_VELOCITY = 0.5 // px/ms — a fast flick triggers even if short

const useDragToDismiss = (
  contentRef: React.RefObject<HTMLDivElement | null>,
  onDismiss: () => void,
  expand: { expandable: boolean; expanded: boolean; setExpanded: (next: boolean) => void }
) => {
  const drag = React.useRef({ active: false, startY: 0, lastY: 0, lastT: 0, velocity: 0 })

  const springBack = () => {
    const el = contentRef.current
    if (!el) return
    el.style.transition = SHEET_TRANSITION
    el.style.transform = 'translateY(0)'
  }

  const onPointerDown = (event: React.PointerEvent) => {
    const el = contentRef.current
    if (!el) return
    drag.current = { active: true, startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0 }
    el.style.transition = 'none'
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current
    if (!state.active) return
    const el = contentRef.current
    if (!el) return
    const dy = event.clientY - state.startY // signed: negative = up, positive = down
    // Up-drag is only meaningful as an expand affordance, and only while there's
    // more to reveal. When already expanded (or not expandable) rubber-band it so
    // the sheet doesn't tear away from the screen edge.
    const canExpand = expand.expandable && !expand.expanded
    const applied = dy < 0 && !canExpand ? dy / 4 : dy
    el.style.transform = `translateY(${applied}px)`
    const dt = event.timeStamp - state.lastT
    if (dt > 0) state.velocity = (event.clientY - state.lastY) / dt
    state.lastY = event.clientY
    state.lastT = event.timeStamp
  }

  const onPointerEnd = (event: React.PointerEvent) => {
    const state = drag.current
    if (!state.active) return
    state.active = false
    if (!contentRef.current) return
    const dy = event.clientY - state.startY
    const fastDown = state.velocity > DRAG_VELOCITY
    const fastUp = state.velocity < -DRAG_VELOCITY

    if (dy > DRAG_DISMISS_DISTANCE || fastDown) {
      // A down-drag on an expanded sheet collapses it first; otherwise dismiss.
      // Leave the transform where the finger is; the exit effect (or spring-back)
      // takes it from there.
      if (expand.expandable && expand.expanded) {
        expand.setExpanded(false)
        springBack()
      } else {
        onDismiss()
      }
    } else if (dy < -DRAG_EXPAND_DISTANCE || fastUp) {
      if (expand.expandable && !expand.expanded) expand.setExpanded(true)
      springBack()
    } else {
      springBack()
    }
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
// dialog: a right-button pointerdown outside is never a dismiss intent (the
// readers bind right-click as the save/remove toggle and expect the open sheet
// to survive and morph), so cancel Radix's close for it.
const ignoreRightClickOutside = (event: { detail: { originalEvent: Event }; preventDefault: () => void }) => {
  const original = event.detail.originalEvent
  if (original instanceof PointerEvent && original.button === 2) event.preventDefault()
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
  const { open, isMobile, expandable, expanded, setExpanded, contentRef, modal, portalContainer, closeSheet } =
    useFloatingSheetContext()
  const rendered = useBottomSheetMotion(open, isMobile, contentRef)
  const dragHandleProps = useDragToDismiss(contentRef, closeSheet, { expandable, expanded, setExpanded })
  const { metrics: scrollMetrics, onScroll: onScrollAffordance } = useScrollAffordanceMetrics(
    visualScrollAffordance,
    contentRef
  )

  if (isMobile) {
    if (!rendered) return null

    const contentClassName = cn(
      'group/floating-sheet bg-background fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-lg border-t shadow-xl outline-none will-change-transform',
      // Always docked at the bottom; the body scrolls internally past the cap.
      expandable ? 'max-h-[96vh]' : 'max-h-[85vh]',
      className
    )

    const inner = (
      <>
        {/* Drag handle — the only place a dismiss-drag can start, so it never
            competes with scrolling the content. `touch-none` keeps the browser
            from turning the gesture into a page scroll. */}
        <div
          {...dragHandleProps}
          className='flex shrink-0 cursor-grab touch-none justify-center pt-3 pb-4 active:cursor-grabbing'
        >
          <div className='bg-muted h-1.5 w-12 rounded-full' />
        </div>
        <div className='flex flex-1 flex-col overflow-y-auto overscroll-none px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
          {children}
        </div>
      </>
    )

    if (!modal) {
      if (typeof document === 'undefined') return null
      return createPortal(
        <div ref={contentRef} className={contentClassName} {...props}>
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
            onPointerDownOutside={ignoreRightClickOutside}
            className={contentClassName}
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
        onPointerDownOutside={ignoreRightClickOutside}
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

interface FloatingSheetFooterProps {
  className?: string
  children: React.ReactNode
}

export const FloatingSheetFooter = ({ className, children }: FloatingSheetFooterProps) => (
  <div
    data-floating-sheet-sticky-footer=''
    className={cn('bg-popover sticky bottom-0 z-10 mt-auto flex flex-col gap-2 px-2 pt-3 pb-3', className)}
  >
    {children}
  </div>
)
