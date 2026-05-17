'use client'

import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { useIsMobile } from '@/hooks/use-is-mobile'

export type FloatingSheetAnchor = HTMLElement | DOMRect | null

interface FloatingSheetContextValue {
  isMobile: boolean
  expandable: boolean
  expanded: boolean
  setExpanded: (expanded: boolean) => void
  closeSheet: () => void
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
  children: React.ReactNode
}

export const FloatingSheet = ({
  open,
  onOpenChange,
  anchor = null,
  expandable = false,
  expanded: expandedProp,
  onExpandedChange,
  children,
}: FloatingSheetProps) => {
  const isMobile = useIsMobile()

  const [localExpanded, setLocalExpanded] = React.useState(false)
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

  // Blur the trigger element on open so Radix/vaul can safely aria-hide the
  // page content without retaining focus on a now-hidden ancestor. The drawer
  // / popover then auto-focuses its own content as usual. useLayoutEffect runs
  // before vaul's aria-hide effects in the bottom-up effect order.
  React.useLayoutEffect(() => {
    if (!open) return
    if (typeof document === 'undefined') return
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) active.blur()
  }, [open])

  const closeSheet = React.useCallback(() => onOpenChange(false), [onOpenChange])

  if (isMobile === undefined) return null

  const ctx: FloatingSheetContextValue = { isMobile, expandable, expanded, setExpanded, closeSheet }

  if (isMobile) {
    // We deliberately skip vaul snap points here — the controlled snap path
    // didn't reliably open on iOS in vaul 1.1.2 (the drawer mounted but stayed
    // off-screen). Without snap points, vaul fits content naturally; when the
    // expanded section becomes visible the drawer grows in place. Trade-off:
    // no drag-up-to-expand gesture, just tap-to-expand via the header chevron.
    return (
      <FloatingSheetContext.Provider value={ctx}>
        <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
          {children}
        </DrawerPrimitive.Root>
      </FloatingSheetContext.Provider>
    )
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
  const { isMobile, expandable } = useFloatingSheetContext()

  if (isMobile) {
    return (
      <DrawerPrimitive.Portal>
        {/* Transparent overlay — needed so vaul registers outside taps as
            dismiss intents, but it never tints the source content. */}
        <DrawerPrimitive.Overlay className='fixed inset-0 z-40 bg-transparent' />
        <DrawerPrimitive.Content
          // Radix-Dialog (vaul wraps it) warns when no <Description> child is
          // rendered. Our floating sheets typically display the relevant info
          // visibly in the header / body; passing `aria-describedby={undefined}`
          // is the documented Radix escape hatch to opt out of the requirement.
          aria-describedby={undefined}
          className={cn(
            'group/floating-sheet bg-background fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-lg border-t shadow-xl outline-none',
            expandable ? 'max-h-[96vh]' : 'max-h-[85vh]',
            className
          )}
        >
          <div className='bg-muted mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full' />
          <div className='flex flex-1 flex-col overflow-y-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
            {children}
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    )
  }

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
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
  const { isMobile } = useFloatingSheetContext()
  if (isMobile) {
    return (
      <DrawerPrimitive.Title className={cn('text-foreground text-base font-semibold', className)}>
        {children}
      </DrawerPrimitive.Title>
    )
  }
  return <h2 className={cn('text-foreground text-base font-semibold', className)}>{children}</h2>
}

interface FloatingSheetDescriptionProps {
  className?: string
  children?: React.ReactNode
}

export const FloatingSheetDescription = ({ className, children }: FloatingSheetDescriptionProps) => {
  const { isMobile } = useFloatingSheetContext()
  if (isMobile) {
    return (
      <DrawerPrimitive.Description className={cn('text-muted-foreground text-sm', className)}>
        {children}
      </DrawerPrimitive.Description>
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
