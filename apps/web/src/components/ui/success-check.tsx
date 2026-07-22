import { Check } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

const tones = {
  // Emerald: finished practice sessions, checkout success.
  success: {
    circle: 'bg-emerald-100 dark:bg-emerald-400/15',
    check: 'text-emerald-600 dark:text-emerald-300',
  },
  // Yellow: reading mode's "all caught up" surfaces, which are yellow-themed.
  reading: {
    circle: 'bg-yellow-100 dark:bg-yellow-400/15',
    check: 'text-yellow-600 dark:text-yellow-400',
  },
}

// The hero checkmark for finished/"all done" states: a soft tinted disc with a
// bold check, shared so every done view carries the same mark instead of an
// ad-hoc outlined icon.
export const SuccessCheck = ({ tone = 'success', className }: { tone?: keyof typeof tones; className?: string }) => (
  <div className={cn('flex size-16 items-center justify-center rounded-full', tones[tone].circle, className)}>
    <Check className={cn('size-7', tones[tone].check)} strokeWidth={2.5} aria-hidden />
  </div>
)
