import { CheckIcon } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { EvidenceLine } from './evidence-line'

// One saved word a declaration step acts on, with its evidence: the surface
// form seen in the text (for MWEs, the anchor content word; null for
// checkpoints stored before evidence existed) and its context window.
export type CheckpointCandidate = {
  userLookupId: string
  headword: string
  sense: string
  matchedSurface: string | null
  context: string | null
}

// Presentational checkbox indicator — deliberately NOT the Radix Checkbox,
// which renders its own <button> and would nest inside the row button
// (invalid HTML). The row is the single interactive element.
const SelectionIndicator = ({ checked }: { checked: boolean }) => (
  <span
    aria-hidden
    className={cn(
      'border-input mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs',
      checked && 'bg-primary text-primary-foreground border-primary'
    )}
  >
    {checked && <CheckIcon className='size-3.5' />}
  </span>
)

type Props = {
  candidates: CheckpointCandidate[]
  deselectedIds: ReadonlySet<string>
  onToggle: (userLookupId: string) => void
  disabled?: boolean
}

// The declaration sheet's word list: every row shows WHERE the word was seen
// and toggles in or out of the step's action. Always rendered in full — the
// reader checks the whole list before acting on it.
export const CandidateChecklist = ({ candidates, deselectedIds, onToggle, disabled = false }: Props) => (
  <ul className='text-sm'>
    {candidates.map((candidate) => {
      const checked = !deselectedIds.has(candidate.userLookupId)
      return (
        <li key={candidate.userLookupId} className='border-b last:border-b-0'>
          <button
            type='button'
            aria-pressed={checked}
            disabled={disabled}
            onClick={() => onToggle(candidate.userLookupId)}
            className={cn(
              'hover:bg-accent active:bg-accent flex w-full items-start gap-2 py-2 text-left transition-colors',
              !checked && 'opacity-60'
            )}
          >
            <SelectionIndicator checked={checked} />
            <span className='min-w-0'>
              <span className='font-medium'>{candidate.headword}</span>
              {candidate.sense && <span className='text-muted-foreground ml-2'>{candidate.sense}</span>}
              <EvidenceLine surface={candidate.matchedSurface} context={candidate.context} />
            </span>
          </button>
        </li>
      )
    })}
  </ul>
)
