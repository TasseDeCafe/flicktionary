import type { ReactNode } from 'react'

// Shared top line of an exercise screen: icon + uppercase track label
// (+ ` · headword` when naming the term can't leak a cloze answer), and an
// optional right-aligned position counter. The dedicated warmup/strengthen
// sessions pass a counter (their queue is static and exercises-only, so
// position/total is honest); the composed queue omits it — its queue grows
// mid-session with Again-redrills, and the remaining-count chips in the
// bottom bar are the queue-status UI there.
export const ExerciseHeader = ({
  icon,
  label,
  headword,
  counter,
}: {
  icon: ReactNode
  label: string
  headword?: string | null
  counter?: string
}) => (
  <div className='flex items-center justify-between'>
    <span className='text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase'>
      {icon}
      {label}
      {headword != null && <> · {headword}</>}
    </span>
    {counter != null && <span className='text-muted-foreground text-xs tabular-nums'>{counter}</span>}
  </div>
)
