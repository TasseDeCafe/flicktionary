import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { usePortalContainer } from './portal'

const Dialog = ({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) => (
  <DialogPrimitive.Root data-slot='dialog' {...props} />
)

const DialogTrigger = ({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) => (
  <DialogPrimitive.Trigger data-slot='dialog-trigger' {...props} />
)

const DialogPortal = ({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) => (
  <DialogPrimitive.Portal data-slot='dialog-portal' {...props} />
)

const DialogClose = ({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) => (
  <DialogPrimitive.Close data-slot='dialog-close' {...props} />
)

// top edge is pushed below iOS 26 Safari's 4px sampling window so its toolbar-tint sampler skips this element and falls back to the body bg (white), keeping the menu bar steady instead of chasing the scrim ~500ms behind. https://jahir.dev/blog/safari-toolbar
const DialogOverlay = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) => (
  <DialogPrimitive.Overlay
    data-slot='dialog-overlay'
    className={cn(
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-x-0 top-[max(env(safe-area-inset-top),5px)] bottom-0 z-50 bg-black/50',
      className
    )}
    {...props}
  />
)

// Shared fade + timing applied to every variant.
const dialogContentBase =
  'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed z-50 shadow-lg duration-200'

// Variant-specific positioning. `center` is the original centered modal.
// `right` is a full-height slide-in panel anchored to the right edge.
// `fullScreen` covers the viewport and slides up from the bottom (mobile chat).
const dialogContentVariants = {
  // 32px margin allowance is px, not the upstream 2rem — rem resolves against
  // the HOST page root font-size inside the extension's shadow surfaces.
  center:
    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 top-[50%] left-[50%] grid w-full max-w-[calc(100%-32px)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 sm:max-w-lg',
  right:
    'inset-y-0 right-0 flex h-dvh w-full max-w-md flex-col rounded-none border-l p-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  fullScreen:
    'inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col rounded-none p-0 data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
} as const

const DialogContent = ({
  className,
  children,
  showCloseButton = true,
  showOverlay = true,
  variant = 'center',
  container,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  // Side/full-screen panels that fully cover (mobile) or sit beside (desktop)
  // their content don't want the dimming scrim — it flashes during the slide
  // animation and blocks scrolling the page behind. Pass false to drop it.
  showOverlay?: boolean
  variant?: keyof typeof dialogContentVariants
  // Portal target override. Defaults to the PortalContainerContext (set by the
  // extension's shadow surfaces), then Radix's document.body fallback.
  container?: HTMLElement | null
}) => {
  const contextContainer = usePortalContainer()
  return (
    <DialogPortal data-slot='dialog-portal' container={container ?? contextContainer ?? undefined}>
      {showOverlay && <DialogOverlay />}
      <DialogPrimitive.Content
        data-slot='dialog-content'
        className={cn(dialogContentBase, dialogContentVariants[variant], className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot='dialog-close'
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className='sr-only'>Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

const DialogHeader = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div data-slot='dialog-header' className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />
)

const DialogFooter = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    data-slot='dialog-footer'
    className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
    {...props}
  />
)

const DialogTitle = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    data-slot='dialog-title'
    className={cn('text-lg leading-none font-semibold', className)}
    {...props}
  />
)

const DialogDescription = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    data-slot='dialog-description'
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
)

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
