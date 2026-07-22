import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

type Props = {
  to: LinkProps['to']
  className?: string
  children: React.ReactNode
}

// The "see more" footer link used by dashboard cards ("More stats",
// "All sessions"): darker than muted so it reads as actionable, with a
// trailing chevron.
export const SeeMoreLink = ({ to, className, children }: Props) => (
  <Link
    to={to}
    className={cn(
      'text-foreground/70 hover:text-foreground active:text-foreground inline-flex items-center gap-0.5 text-sm font-medium transition-colors',
      className
    )}
  >
    {children}
    <ChevronRight className='size-4' />
  </Link>
)
