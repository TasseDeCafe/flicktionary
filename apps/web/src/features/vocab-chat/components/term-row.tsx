import type { ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Check } from 'lucide-react'
import { Skeleton } from '@flicktionary/ui/components/skeleton'

// One suggested term (headword, note, example). Shared by "Translate & add"
// results and chat proposals so both read and add the same way. The term's
// text takes the full width; status and actions share one line underneath, so
// a narrow screen doesn't squeeze the note into a column.
export const TermRow = ({
  headword,
  note,
  example,
  status,
  actions,
}: {
  headword: string
  note: string
  example: string
  status?: ReactNode
  actions: ReactNode
}) => (
  <li className='flex flex-col gap-2 px-4 py-3'>
    <div className='flex min-w-0 flex-col gap-0.5'>
      <span className='font-semibold'>{headword}</span>
      {note && <span className='text-muted-foreground text-sm'>{note}</span>}
      {example && <span className='text-sm italic'>{example}</span>}
    </div>
    <div className='flex min-h-8 items-center justify-between gap-2'>
      <div className='flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap'>{status}</div>
      <div className='flex shrink-0 items-center gap-2'>{actions}</div>
    </div>
  </li>
)

// The status at the start of a row's action line: what the learner already
// has, or what just happened. Single line; long text truncates.
export const TermRowStatus = ({ children, tone }: { children: ReactNode; tone: 'added' | 'muted' }) =>
  tone === 'added' ? (
    <span className='flex min-w-0 items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400'>
      <Check className='size-3.5 shrink-0' />
      <span className='truncate'>{children}</span>
    </span>
  ) : (
    <span className='text-muted-foreground truncate'>{children}</span>
  )

// The same headword saved with another meaning: says why the row still
// offers Add. Nothing when there's no such sense.
export const OtherSensesStatus = ({ senses }: { senses: string[] }) => {
  const { t } = useLingui()
  if (senses.length === 0) return null
  const savedSenses = senses.map((sense) => `"${sense}"`).join(', ')
  return <TermRowStatus tone='muted'>{t`You have it as ${savedSenses}`}</TermRowStatus>
}

export const TermRowSkeleton = () => (
  <div className='flex flex-col gap-2 rounded-xl border px-4 py-3'>
    <div className='flex flex-col gap-2'>
      <Skeleton className='h-5 w-32' />
      <Skeleton className='h-4 w-48' />
      <Skeleton className='h-4 w-56' />
    </div>
    <div className='flex items-center justify-between gap-2'>
      <Skeleton className='h-4 w-24' />
      <Skeleton className='h-8 w-16' />
    </div>
  </div>
)
