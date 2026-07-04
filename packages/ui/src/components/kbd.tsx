import type { ReactNode } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// Keyboard-hint badge rendered inside buttons/options that have a hotkey.
// Borders and text ride currentColor so it stays legible on filled, outline
// and plain surfaces alike; pointer-events-none so it never steals the click.
// Hosts render it desktop-only — on touch there is no keyboard to teach.
// Corner-keycap variant for square icon-only buttons (host must be
// `relative`): an inline badge beside the icon would read as a separate
// element in a borderless ghost button, so the key pins to the button's
// bottom-right corner instead. Opaque + full opacity so it stays legible
// where it overhangs the button's edge.
export const KBD_CORNER_CLASS = 'absolute -right-1 -bottom-1 h-4 min-w-4 bg-background px-0.5 text-[10px] opacity-100'

export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => (
  <kbd
    className={cn(
      'pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded border border-current/30 px-1 font-sans text-[11px] font-medium opacity-70',
      className
    )}
  >
    {children}
  </kbd>
)
