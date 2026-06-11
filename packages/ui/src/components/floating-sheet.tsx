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
    const handleScroll = () => onOpenChange(false)
    document.addEventListener('scroll', handleScroll, { capture: true })
    return () => document.removeEventListener('scroll', handleScroll, { capture: true })
  }, [open, isMobile, closeOnScroll, onOpenChange])

  React.useEffect(() => {
    if (!open || isMobile !== true || modal) return
    const handleOutsideStart = (event: Event) => {
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

// Gap (px) left between the tapped word and a flipped-above sheet.
const FLIP_GAP = 8

// On mobile the sheet is a bottom drawer by default. When the tapped word sits
// low enough that the bottom drawer would cover it, we flip the sheet so it
// rests just *above* the word instead — keeping the word (and the text below
// it) visible, which matters once reading switches to paginated pages that
// can't be scrolled. Vaul has no concept of anchoring to an element, so we
// override the drawer's `bottom` / `max-height` inline after measuring its
// rendered height. Measuring in a layout effect (before paint) avoids a jump.
const useMobileFlipStyle = ({
  open,
  isMobile,
  anchor,
  contentRef,
}: {
  open: boolean
  isMobile: boolean
  anchor: FloatingSheetAnchor
  contentRef: React.RefObject<HTMLDivElement | null>
}): React.CSSProperties | undefined => {
  const [style, setStyle] = React.useState<React.CSSProperties | undefined>(undefined)

  // Reset the flip on the open transition (not on close): the sheet must mount
  // docked so we measure its natural, unclamped height — and so a previous
  // open's flip can't make the new measurement read a clamped box. Doing it
  // during render means the docked style is committed before the measuring
  // layout effect runs. We deliberately keep the style applied while closing so
  // a flipped sheet stays anchored above the word as it fades out.
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setStyle(undefined)
  }

  React.useLayoutEffect(() => {
    if (!open || !isMobile || typeof window === 'undefined') return
    const rect = rectFromAnchor(anchor)
    const el = contentRef.current
    if (!rect || !el) {
      setStyle(undefined)
      return
    }

    // The flip is sticky once triggered: we only ever go bottom → above within a
    // single open, never back. This matters because (a) the sheet's content can
    // load/grow *after* the first measurement — the very first open of a session
    // measures a short, still-loading sheet that doesn't yet cover the word — and
    // (b) once flipped, the inline max-height clamps the measured height, so
    // re-evaluating would read a smaller box and wrongly un-flip.
    let flipped = false
    const measure = () => {
      if (flipped) return
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      const sheetHeight = el.offsetHeight
      // Top edge of the drawer in its default bottom placement. If that edge
      // sits below the word's top, the word is hidden behind the drawer → flip.
      const bottomDrawerTop = viewportHeight - sheetHeight
      if (rect.top - FLIP_GAP <= bottomDrawerTop) return
      flipped = true
      setStyle({
        top: 'auto',
        // Pin the sheet's bottom edge just above the word; content then grows
        // upward and scrolls internally if it runs out of room.
        bottom: viewportHeight - rect.top + FLIP_GAP,
        maxHeight: Math.max(160, rect.top - FLIP_GAP - 8),
      })
    }

    measure()
    // Re-measure as the sheet's content settles (async gloss/definition load,
    // font swap, expand) so a late-growing sheet still flips above the word.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [open, isMobile, anchor, contentRef])

  return style
}

// Shared motion timing for enter / exit / drag spring-back. We drive the motion
// with a CSS *transition* (not a keyframe animation) so the inline transform we
// set while dragging composes with it instead of being overridden.
const SHEET_DURATION_MS = 240
const SHEET_TRANSITION = `transform ${SHEET_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`
// When flipped above the word the sheet is really a popover, so it fades rather
// than sliding all the way down to the screen edge to dismiss.
const POPOVER_DURATION_MS = 150
const POPOVER_TRANSITION = `opacity ${POPOVER_DURATION_MS}ms ease`

// Mounts/unmounts the mobile sheet around an open/close animation, replacing the
// enter/exit that vaul used to give us. `rendered` stays true through the exit
// animation so the sheet can animate out before it leaves the DOM. All transform
// / opacity writes are imperative (on contentRef) so they never fight React's
// style prop — which only ever owns the flip-above `bottom`/`max-height`.
//
// Enter always slides up (reads fine docked or flipped). The exit is
// position-aware: a docked sheet slides back down to the edge, but a flipped
// sheet is a popover, so it fades out in place rather than travelling past the
// word. The flip state has reliably settled by the time we dismiss, so reading
// it here (unlike at enter time) is safe.
const useBottomSheetMotion = (
  open: boolean,
  isMobile: boolean,
  flipped: boolean,
  contentRef: React.RefObject<HTMLDivElement | null>
) => {
  const [rendered, setRendered] = React.useState(open)

  // Mount the moment we open — during render, not in an effect. This re-renders
  // before the commit, so contentRef is populated before the sibling layout
  // effects run on this same commit (notably the flip-above-word measurement,
  // which needs to read the rendered sheet's height). Mounting in an effect
  // instead lands a tick late and those effects measure a not-yet-rendered sheet.
  if (isMobile && open && !rendered) setRendered(true)

  // Enter: pin off-screen, then transition up to the resting position. The
  // start position is committed before paint, so there's no flash at y=0. We
  // also reset opacity in case a prior flipped exit left the element faded.
  React.useLayoutEffect(() => {
    if (!isMobile || !open || !rendered) return
    const el = contentRef.current
    if (!el) return
    el.style.transition = 'none'
    el.style.opacity = '1'
    el.style.transform = 'translateY(100%)'
    void el.offsetHeight // force reflow so the next change actually transitions
    el.style.transition = SHEET_TRANSITION
    el.style.transform = 'translateY(0)'
  }, [isMobile, open, rendered, contentRef])

  // Exit: slide down (docked) or fade in place (flipped popover), then unmount.
  React.useEffect(() => {
    if (!isMobile || open || !rendered) return
    const el = contentRef.current
    if (!el) {
      setRendered(false)
      return
    }
    const duration = flipped ? POPOVER_DURATION_MS : SHEET_DURATION_MS
    if (flipped) {
      // Fade out, leaving whatever transform it has (resting, or mid-drag) so it
      // dissolves where it sits instead of sliding off.
      el.style.transition = POPOVER_TRANSITION
      el.style.opacity = '0'
    } else {
      // Slide down from wherever it is (resting, or mid-drag) to the edge.
      el.style.transition = SHEET_TRANSITION
      el.style.transform = 'translateY(100%)'
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      setRendered(false)
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target !== el) return
      if (event.propertyName === 'transform' || event.propertyName === 'opacity') finish()
    }
    el.addEventListener('transitionend', onEnd)
    // Safety net: if transitionend never fires (interrupted, tab hidden) we
    // still unmount so the sheet can't get stuck on screen.
    const timer = window.setTimeout(finish, duration + 80)
    return () => {
      el.removeEventListener('transitionend', onEnd)
      window.clearTimeout(timer)
    }
  }, [isMobile, open, rendered, flipped, contentRef])

  return isMobile ? rendered : open
}

// Drag-to-dismiss for the drag handle. We only ever start a drag from the
// handle, so this never competes with scrolling the sheet's own content. The
// finger drives an inline translateY; on release we either dismiss (handing the
// slide-out to useBottomSheetMotion) or spring back to rest.
const DRAG_DISMISS_DISTANCE = 80 // px dragged past which we dismiss on release
const DRAG_DISMISS_VELOCITY = 0.5 // px/ms — a fast flick dismisses even if short

const useDragToDismiss = (contentRef: React.RefObject<HTMLDivElement | null>, onDismiss: () => void) => {
  const drag = React.useRef({ active: false, startY: 0, lastY: 0, lastT: 0, velocity: 0 })

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
    const dy = Math.max(0, event.clientY - state.startY)
    el.style.transform = `translateY(${dy}px)`
    const dt = event.timeStamp - state.lastT
    if (dt > 0) state.velocity = (event.clientY - state.lastY) / dt
    state.lastY = event.clientY
    state.lastT = event.timeStamp
  }

  const onPointerEnd = (event: React.PointerEvent) => {
    const state = drag.current
    if (!state.active) return
    state.active = false
    const el = contentRef.current
    if (!el) return
    const dy = Math.max(0, event.clientY - state.startY)
    if (dy > DRAG_DISMISS_DISTANCE || state.velocity > DRAG_DISMISS_VELOCITY) {
      // Leave the transform where the finger left it; the exit effect slides it
      // the rest of the way down once `open` flips to false.
      onDismiss()
    } else {
      el.style.transition = SHEET_TRANSITION
      el.style.transform = 'translateY(0)'
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

export const FloatingSheetContent = ({ className, children }: FloatingSheetContentProps) => {
  const { open, isMobile, expandable, contentRef, modal, anchor, closeSheet } = useFloatingSheetContext()
  const flipStyle = useMobileFlipStyle({ open, isMobile, anchor, contentRef })
  const rendered = useBottomSheetMotion(open, isMobile, flipStyle != null, contentRef)
  const dragHandleProps = useDragToDismiss(contentRef, closeSheet)

  if (isMobile) {
    if (!rendered) return null

    const contentClassName = cn(
      'group/floating-sheet bg-background fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-lg border-t shadow-xl outline-none will-change-transform',
      // When flipped above the word the cap is supplied inline via flipStyle.
      flipStyle ? undefined : expandable ? 'max-h-[96vh]' : 'max-h-[85vh]',
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
        <div ref={contentRef} className={contentClassName} style={flipStyle}>
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
            className={contentClassName}
            style={flipStyle}
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
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 z-50 w-80 origin-(--radix-popover-content-transform-origin) rounded-md border px-2 py-0 shadow-xl outline-hidden',
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
