import { type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, X } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@/components/ui/button'

interface ModalScreenProps {
  // Always navigate to a known parent route — never `history.back()`. Deep-linked
  // tabs have no history to pop, and we want X to land somewhere predictable.
  onClose: () => void
  closeIcon?: 'x' | 'chevron'
  title?: ReactNode
  rightSlot?: ReactNode
  className?: string
  children: ReactNode
}

export const ModalScreen = ({ onClose, closeIcon = 'x', title, rightSlot, className, children }: ModalScreenProps) => {
  const { t } = useLingui()
  const Icon = closeIcon === 'x' ? X : ChevronLeft
  const closeLabel = closeIcon === 'x' ? t`Close` : t`Back`
  return (
    <div className={cn('flex h-dvh flex-col bg-white', className)}>
      <header className='flex h-14 shrink-0 items-center gap-2 border-b bg-white px-2'>
        <Button variant='ghost' size='icon' onClick={onClose} aria-label={closeLabel}>
          <Icon className='size-6 md:size-5' />
        </Button>
        {title && <h1 className='min-w-0 flex-1 truncate text-base font-semibold'>{title}</h1>}
        {!title && <div className='flex-1' />}
        {rightSlot && <div className='flex items-center gap-2 pr-1'>{rightSlot}</div>}
      </header>
      <div className='flex flex-1 flex-col overflow-hidden'>{children}</div>
    </div>
  )
}
