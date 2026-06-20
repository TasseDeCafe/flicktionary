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
  children,
}: FloatingSheetProps) => {
  const isMobile = useIsMobile()

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
const useBottomSheetMotion = (
  open: boolean,
  isMobile: boolean,
  contentRef: React.RefObject<HTMLDivElement | null>
) => {
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

interface FloatingSheetContentProps {
  className?: string
  children: React.ReactNode
}

// Radix dismissal filter shared by the desktop popover and the modal mobile
// dialog: a right-button pointerdown outside is never a dismiss intent (the
// readers bind right-click as the save/remove toggle and expect the open sheet
// to survive and morph), so cancel Radix's close for it.
const ignoreRightClickOutside = (event: { detail: { originalEvent: Event }; preventDefault: () => void }) => {
  const original = event.detail.originalEvent
  if (original instanceof PointerEvent && original.button === 2) event.preventDefault()
}

export const FloatingSheetContent = ({ className, children }: FloatingSheetContentProps) => {
  const { open, isMobile, expandable, expanded, setExpanded, contentRef, modal, closeSheet } = useFloatingSheetContext()
  const rendered = useBottomSheetMotion(open, isMobile, contentRef)
  const dragHandleProps = useDragToDismiss(contentRef, closeSheet, { expandable, expanded, setExpanded })

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
        <div className='flex flex-1 flex-col overflow-y-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
          {children}
        </div>
      </>
    )

    if (!modal) {
      if (typeof document === 'undefined') return null
      return createPortal(
        <div ref={contentRef} className={contentClassName}>
          {inner}
        </div>,
        document.body
      )
    }

    return (
      // Kept open through the exit animation (rendered stays true until the
      // slide-out finishes); a Radix-initiated close (escape / outside tap)
      // routes through closeSheet so the same animation plays.
      <DialogPrimitive.Root open modal onOpenChange={(next) => !next && closeSheet()}>
        <DialogPrimitive.Portal>
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
          >
            {inner}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    )
  }

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={contentRef}
        side='bottom'
        align='start'
        sideOffset={6}
        collisionPadding={12}
        onPointerDownOutside={ignoreRightClickOutside}
        className={cn(
          // scrollbar-affordance (tokens.css): a persistent scrollbar when the
          // capped popover overflows, so the user sees there's more to scroll.
          'scrollbar-affordance bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 z-50 max-h-[var(--radix-popover-content-available-height)] w-80 origin-(--radix-popover-content-transform-origin) overflow-y-auto rounded-md border px-2 py-0 shadow-xl outline-hidden',
          className
        )}
      >
        {children}
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
  // video-overlay popovers use GlossCardBody OUTSIDE any FloatingSheet (they
  // position with floating-ui directly). Without a sheet there is no Radix
  // Dialog to describe, so the plain <p> branch is always correct there.
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
  <div className={cn('mt-auto flex flex-col gap-2 px-2 pt-2 pb-3', className)}>{children}</div>
)

interface FloatingSheetExpandedProps {
  className?: string
  children: React.ReactNode
}

// Children render only when the sheet is in the expanded state (drag-up on
// mobile, accordion toggle on desktop). Caller must declare `expandable` on the
// root to opt in.
export const FloatingSheetExpanded = ({ className, children }: FloatingSheetExpandedProps) => {
  const { expandable, expanded } = useFloatingSheetContext()
  if (!expandable || !expanded) return null
  return <div className={cn('flex flex-col gap-3 border-t px-2 pt-3 pb-2', className)}>{children}</div>
}

interface FloatingSheetExpandToggleProps {
  className?: string
  // Render callback receives both `expanded` and `isMobile` so the caller can
  // pick the right chevron direction per platform (the drawer "expands up"
  // visually on mobile, while the desktop popover grows downward).
  children: React.ReactNode | ((expanded: boolean, isMobile: boolean) => React.ReactNode)
  ariaLabel?: string
}

export const FloatingSheetExpandToggle = ({ className, children, ariaLabel }: FloatingSheetExpandToggleProps) => {
  const { expandable, expanded, setExpanded, isMobile } = useFloatingSheetContext()
  if (!expandable) return null
  return (
    <button
      type='button'
      onClick={() => setExpanded(!expanded)}
      aria-expanded={expanded}
      aria-label={ariaLabel}
      className={className}
    >
      {typeof children === 'function' ? children(expanded, isMobile) : children}
    </button>
  )
}
