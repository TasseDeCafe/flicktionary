import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// The transition list deliberately excludes opacity: animating the
// disabled:opacity-50 flip makes iOS Safari promote the button to a compositing
// layer, and when the label swaps in the same frame (e.g. "Confirm" → "Saving…")
// it blends the stale text snapshot over the new label for the transition's
// duration.
const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5 md:[&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        // --secondary sits at 96% lightness, so a /80 alpha hover blends back
        // into a white page invisibly — hover/press need genuinely darker fills
        // (same approach as ghost's active state, with dark-theme overrides).
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-slate-200 active:bg-slate-300 dark:hover:bg-secondary/80 dark:active:bg-secondary/60',
        ghost:
          'hover:bg-accent hover:text-accent-foreground active:bg-slate-200 active:text-accent-foreground dark:hover:bg-accent/50 dark:active:bg-accent',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        xl: 'h-12 rounded-md px-6 text-base has-[>svg]:px-4',
        icon: 'size-11 md:size-9',
        'icon-sm': 'size-10 md:size-8',
        'icon-lg': 'size-12 md:size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

const Button = ({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) => {
  const Comp = asChild ? Slot : 'button'

  return <Comp data-slot='button' className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
