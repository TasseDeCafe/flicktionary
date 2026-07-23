import { type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, X } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'

interface ModalScreenHeaderProps {
  // Always navigate to a known parent route — never `history.back()`. Deep-linked
  // tabs have no history to pop, and we want X to land somewhere predictable.
  onClose: () => void
  closeIcon?: 'x' | 'chevron'
  title?: ReactNode
  rightSlot?: ReactNode
  className?: string
}

// The header bar on its own — overflow tab views (see OverflowTabHeader) reuse
// it so their mobile chrome is pixel-identical to a modal screen's.
export const ModalScreenHeader = ({
  onClose,
  closeIcon = 'x',
  title,
  rightSlot,
  className,
}: ModalScreenHeaderProps) => {
  const { t } = useLingui()
  const Icon = closeIcon === 'x' ? X : ChevronLeft
  const closeLabel = closeIcon === 'x' ? t`Close` : t`Back`
  return (
    <header className={cn('bg-background flex h-14 shrink-0 items-center gap-2 border-b px-2', className)}>
      <Button variant='ghost' size='icon' onClick={onClose} aria-label={closeLabel}>
        <Icon className='size-6 md:size-5' />
      </Button>
      {title && <h1 className='min-w-0 flex-1 truncate text-base font-semibold'>{title}</h1>}
      {!title && <div className='flex-1' />}
      {rightSlot && <div className='flex items-center gap-2 pr-1'>{rightSlot}</div>}
    </header>
  )
}

interface ModalScreenProps extends ModalScreenHeaderProps {
  children: ReactNode
}

export const ModalScreen = ({ onClose, closeIcon, title, rightSlot, className, children }: ModalScreenProps) => (
  <div className={cn('bg-background flex h-dvh flex-col', className)}>
    <ModalScreenHeader onClose={onClose} closeIcon={closeIcon} title={title} rightSlot={rightSlot} />
    <div className='flex flex-1 flex-col overflow-hidden'>{children}</div>
  </div>
)
