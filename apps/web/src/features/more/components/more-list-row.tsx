import { type ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

interface MoreListRowProps {
  icon?: LucideIcon
  label: string
  description?: string
  // Right-side content. Either a value string (rendered grey), an arbitrary node
  // (e.g. a Switch), or omitted (defaults to a chevron when onPress is set).
  trailing?: ReactNode
  onPress?: () => void
  destructive?: boolean
  disabled?: boolean
  showChevron?: boolean
}

export const MoreListRow = ({
  icon: Icon,
  label,
  description,
  trailing,
  onPress,
  destructive,
  disabled,
  showChevron,
}: MoreListRowProps) => {
  const isInteractive = !!onPress
  // Default chevron when the row is pressable and no trailing slot was provided.
  const showDefaultChevron = showChevron ?? (isInteractive && !destructive)
  const trailingNode = trailing ?? (showDefaultChevron ? <ChevronRight className='h-5 w-5 text-muted-foreground' /> : null)
  const Tag = isInteractive ? 'button' : 'div'

  return (
    <Tag
      type={isInteractive ? 'button' : undefined}
      onClick={isInteractive ? onPress : undefined}
      disabled={isInteractive ? disabled : undefined}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
        isInteractive && 'hover:bg-accent active:bg-accent disabled:opacity-50',
        destructive && 'text-destructive'
      )}
    >
      {Icon && (
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
            destructive ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground'
          )}
        >
          <Icon className='h-4 w-4' />
        </span>
      )}
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-sm font-medium'>{label}</span>
        {description && <span className='text-muted-foreground truncate text-xs'>{description}</span>}
      </span>
      {trailingNode && <span className='ml-auto flex shrink-0 items-center'>{trailingNode}</span>}
    </Tag>
  )
}
