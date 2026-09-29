import type { ReactNode } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// The translucent action bar pinned to the bottom of a scrolling view (the
// WizardShell footer, standalone CTAs). Callers own the inner column, since its
// width and layout vary per view; `className` adjusts the padding.
export const StickyFooter = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div
    className={cn(
      'bg-background/95 pb-safe sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 backdrop-blur',
      className
    )}
  >
    {children}
  </div>
)
