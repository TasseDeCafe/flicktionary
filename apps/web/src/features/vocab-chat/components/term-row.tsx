import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Skeleton } from '@flicktionary/ui/components/skeleton'

// One suggested term (headword, note, example) with its action on the right.
// Shared by "Translate & add" results and chat proposals so both read and add
// the same way.
export const TermRow = ({
  headword,
  note,
  example,
  action,
}: {
  headword: string
  note: string
  example: string
  action: ReactNode
}) => (
  <li className='flex items-start gap-3 px-4 py-3'>
    <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
      <span className='font-semibold'>{headword}</span>
      {note && <span className='text-muted-foreground text-sm'>{note}</span>}
      {example && <span className='text-sm italic'>{example}</span>}
    </div>
    <div className='flex shrink-0 flex-col items-end gap-1.5'>{action}</div>
  </li>
)

// A row's status line above (or instead of) its button, so it isn't mistaken
// for the button.
export const TermRowStatus = ({ children, tone }: { children: ReactNode; tone: 'added' | 'muted' }) =>
  tone === 'added' ? (
    <span className='flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400'>
      <Check className='size-3.5' />
      {children}
    </span>
  ) : (
    <span className='text-muted-foreground text-xs'>{children}</span>
  )

export const TermRowSkeleton = () => (
  <div className='flex items-start gap-3 rounded-xl border px-4 py-3'>
    <div className='flex flex-1 flex-col gap-2'>
      <Skeleton className='h-5 w-32' />
      <Skeleton className='h-4 w-48' />
      <Skeleton className='h-4 w-56' />
    </div>
    <Skeleton className='h-8 w-16' />
  </div>
)
