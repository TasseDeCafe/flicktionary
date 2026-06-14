import type { ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Skeleton } from './skeleton'

// Placeholder matching an OptionCard's `navigation` row (icon box + title /
// description lines + trailing indicator) so list-pick wizard steps don't jump
// when results arrive. `icon={false}` for rows rendered without a leading icon.
export const OptionCardSkeleton = ({ icon = true }: { icon?: boolean }) => (
  <div className='bg-card flex w-full items-center gap-3 rounded-xl border p-4'>
    {icon && <Skeleton className='h-10 w-10 shrink-0 rounded-lg' />}
    <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
      <Skeleton className='h-4 w-2/5' />
      <Skeleton className='h-3 w-3/5' />
    </div>
    <Skeleton className='h-5 w-5 shrink-0 rounded-md' />
  </div>
)

type OptionCardProps = {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  // `radio` (default) renders a radio-dot indicator on the right and keeps the
  // selected state visible. `navigation` renders a chevron-right and is meant
  // for list-pick flows where tapping a row immediately advances the wizard.
  variant?: 'radio' | 'navigation'
  // The right-hand selection indicator (ignored when variant is `navigation`).
  // `radio` (default) is a round dot for single-select; `checkbox` is a square
  // box with a check for multi-select lists.
  indicator?: 'radio' | 'checkbox'
  selected?: boolean
  disabled?: boolean
  onSelect: () => void
  className?: string
}

export const OptionCard = ({
  icon,
  title,
  description,
  badge,
  variant = 'radio',
  indicator = 'radio',
  selected = false,
  disabled,
  onSelect,
  className,
}: OptionCardProps) => {
  const isNav = variant === 'navigation'
  const isCheckbox = indicator === 'checkbox'
  return (
    <button
      type='button'
      role={isNav ? undefined : isCheckbox ? 'checkbox' : 'radio'}
      aria-checked={isNav ? undefined : selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'group bg-card flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors',
        'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-foreground ring-foreground/10 ring-2'
          : 'border-border hover:border-foreground/40 hover:bg-accent/40 active:bg-accent/60',
        className
      )}
    >
      {icon && (
        <div className='bg-muted text-foreground flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg [&_svg]:size-5'>
          {icon}
        </div>
      )}
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <div className='flex items-center gap-2'>
          <div className='truncate text-base font-medium'>{title}</div>
          {badge && (
            <span className='bg-muted text-muted-foreground inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs'>
              {badge}
            </span>
          )}
        </div>
        {description && <div className='text-muted-foreground line-clamp-2 text-sm'>{description}</div>}
      </div>
      {isNav ? (
        <ChevronRight className='text-muted-foreground h-5 w-5 shrink-0' aria-hidden='true' />
      ) : isCheckbox ? (
        <div
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors',
            selected ? 'border-foreground bg-foreground' : 'border-muted-foreground/40 group-hover:border-foreground/60'
          )}
          aria-hidden='true'
        >
          {selected && <Check className='text-background h-3.5 w-3.5' />}
        </div>
      ) : (
        <div
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
            selected ? 'border-foreground bg-foreground' : 'border-muted-foreground/40 group-hover:border-foreground/60'
          )}
          aria-hidden='true'
        >
          {selected && <div className='bg-background h-1.5 w-1.5 rounded-full' />}
        </div>
      )}
    </button>
  )
}
