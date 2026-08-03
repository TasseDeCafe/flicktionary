import { plural } from '@lingui/core/macro'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import type { SessionDifficulty } from '../api/sessions-hooks'
import { useDifficultyLabelText } from '../hooks/use-difficulty-label-text'

const LABEL_CLASSES: Record<NonNullable<SessionDifficulty['label']>, string> = {
  comfortable: 'text-emerald-600 dark:text-emerald-400',
  challenging: 'text-amber-600 dark:text-amber-400',
  frustrating: 'text-rose-600 dark:text-rose-400',
}

type Props = {
  difficulty: SessionDifficulty | undefined
  // First-load state of the batch query — shows the placeholder instead of a
  // blank that later pops in.
  isLoading?: boolean
  // Rendered before the stat when (and only when) the stat is visible, so the
  // caller's "A · B" meta line composes cleanly.
  prefix?: string
}

// The compact per-session difficulty stat ("~93% comfortable") for card meta
// lines and the session header. Skeleton while the profile builds (pending) or
// the batch query first loads; absent for unsupported/failed sessions and
// empty profiles. Below the tracked-vocab floor the verdict is suppressed
// (null percent/label on an 'available' result) but the entry point must
// survive — sweeping words as known is exactly how a new user crosses the
// floor — so the stat falls back to the neutral unknown-word count.
export const SessionDifficultyStat = ({ difficulty, isLoading = false, prefix }: Props) => {
  const labelText = useDifficultyLabelText()
  if (difficulty?.status === 'pending' || (isLoading && !difficulty)) {
    return (
      <>
        {prefix}
        <Skeleton className='inline-block h-3 w-14 align-middle' />
      </>
    )
  }
  if (difficulty?.status !== 'available') return null
  if (difficulty.expectedCoveragePercent === null || difficulty.label === null) {
    const unknownCount = difficulty.unknownLemmaCount ?? 0
    if (unknownCount === 0) return null
    return (
      <>
        {prefix}
        <span className='whitespace-nowrap'>
          {plural(unknownCount, { one: '# unknown word', other: '# unknown words' })}
        </span>
      </>
    )
  }
  return (
    <>
      {prefix}
      <span className='inline-flex items-baseline gap-1 whitespace-nowrap'>
        <span>~{difficulty.expectedCoveragePercent}%</span>
        <span className={LABEL_CLASSES[difficulty.label]}>{labelText(difficulty.label)}</span>
      </span>
    </>
  )
}
