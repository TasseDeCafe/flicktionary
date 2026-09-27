import { useRef, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useVisualViewportPin } from '@/hooks/use-visual-viewport-pin'
import { ChevronLeft, X } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { VerticalCollapse } from '@/components/ui/vertical-collapse'

interface ModalScreenHeaderProps {
  // Single-entry screens navigate to their fixed parent route. Screens with
  // several entry points use useModalScreenClose, which returns to the actual
  // opener and falls back to the fixed parent on deep links (which have no
  // in-app history to pop). Never call raw `history.back()` here.
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
  // Replaces the header bar wholesale, for modes that take the bar over (the
  // reader's search field). Omit to render the standard ModalScreenHeader.
  header?: ReactNode
  // Slides the header bar away (height to zero, so the content below grows
  // into the space) for screens that hide their chrome while reading.
  headerHidden?: boolean
}

export const ModalScreen = ({
  onClose,
  closeIcon,
  title,
  rightSlot,
  className,
  header,
  headerHidden = false,
  children,
}: ModalScreenProps) => {
  const rootRef = useRef<HTMLDivElement>(null)
  // `h-dvh` tracks the layout viewport, which iOS Safari does not shrink for
  // the on-screen keyboard — bottom-anchored CTAs inside every modal screen
  // (wizard footers, practice check bars, sticky submit buttons) would sit
  // behind it. The pin keeps the whole screen inside the visual viewport;
  // `relative` gives its `top` offset something to act on.
  useVisualViewportPin(rootRef)
  return (
    <div
      ref={rootRef}
      className={cn('bg-background ios-standalone:pt-status-blur relative flex h-dvh flex-col', className)}
    >
      <VerticalCollapse collapsed={headerHidden}>
        {header ?? <ModalScreenHeader onClose={onClose} closeIcon={closeIcon} title={title} rightSlot={rightSlot} />}
      </VerticalCollapse>
      <div className='flex flex-1 flex-col overflow-hidden'>{children}</div>
    </div>
  )
}
