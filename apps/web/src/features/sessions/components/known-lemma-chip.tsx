import { X } from 'lucide-react'
import { useLingui } from '@lingui/react/macro'
import { useUnmarkKnownLemma } from '../api/sessions-hooks'

type Props = {
  targetLanguage: string
  // The gloss response's knownLemmaCandidates — un-marking removes ALL of
  // them (symmetric with the sweep marking every candidate of an ambiguous
  // token; per-candidate choice isn't worth its complexity for
  // invisible-noise homographs).
  lemmas: string[]
  onRemoved: () => void
}

// The gloss-sheet "Marked as known" chip: shows when the selection resolves to
// a lemma the user bulk-marked, with removal as the single action (the
// correction path for "I marked it known but I don't actually know it"). No
// success toast — the chip disappearing is the feedback.
export const KnownLemmaChip = ({ targetLanguage, lemmas, onRemoved }: Props) => {
  const { t } = useLingui()
  const { mutate: unmarkKnownLemma, isPending } = useUnmarkKnownLemma()
  if (lemmas.length === 0) return null
  return (
    <button
      type='button'
      disabled={isPending}
      onClick={() => unmarkKnownLemma({ targetLanguage, lemmas }, { onSuccess: onRemoved })}
      className='text-muted-foreground hover:text-foreground active:bg-accent inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50'
      aria-label={t`Remove the known mark`}
    >
      {t`Marked as known`}
      <X className='h-3 w-3' />
    </button>
  )
}
