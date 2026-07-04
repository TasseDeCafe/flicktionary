import type { LucideIcon } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

type Variant = 'default' | 'destructive'

interface OverlayActionRowProps {
  icon: LucideIcon
  label: string
  description?: string
  onClick: () => void
  disabled?: boolean
  variant?: Variant
}

export const OverlayActionRow = ({
  icon: Icon,
  label,
  description,
  onClick,
  disabled,
  variant = 'default',
}: OverlayActionRowProps) => (
  <button
    type='button'
    disabled={disabled}
    onClick={(event) => {
      // Blur ourselves before firing the handler. The handler often closes the
      // host drawer/dialog; if focus is still on this button when Radix/Vaul
      // applies aria-hidden during the close animation, Chrome logs a
      // "Blocked aria-hidden on an element because its descendant retained
      // focus" warning. Blurring here breaks the chain.
      event.currentTarget.blur()
      onClick()
    }}
    className={cn(
      'flex w-full items-center gap-4 rounded-lg px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
      variant === 'destructive'
        ? 'hover:bg-destructive/10 active:bg-destructive/20'
        : 'hover:bg-accent active:bg-accent'
    )}
  >
    <span
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
        variant === 'destructive'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-yellow-100 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-300'
      )}
    >
      <Icon className='h-5 w-5' />
    </span>
    <span className='flex min-w-0 flex-col'>
      <span className={cn('text-base font-medium', variant === 'destructive' && 'text-destructive')}>{label}</span>
      {description && <span className='text-muted-foreground text-sm'>{description}</span>}
    </span>
  </button>
)
