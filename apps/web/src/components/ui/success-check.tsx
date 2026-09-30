import { Check } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// The hero checkmark for finished/"all done" states (finished practice
// sessions, checkout success): a soft emerald disc with a bold check, shared so
// every done view carries the same mark instead of an ad-hoc outlined icon.
export const SuccessCheck = ({ className }: { className?: string }) => (
  <div
    className={cn(
      'flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-400/15',
      className
    )}
  >
    <Check className='size-7 text-emerald-600 dark:text-emerald-300' strokeWidth={2.5} aria-hidden />
  </div>
)
