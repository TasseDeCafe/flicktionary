import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { toast } from 'sonner'
import { Button } from '@flicktionary/ui/components/button'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  OverlayDescription,
  OverlayFooter,
} from '@/components/ui/responsive-overlay'
import { useMarkKnownPreview, useMarkRemainingKnown, type SessionDifficulty } from '../api/sessions-hooks'
import { useDifficultyLabelText } from '../hooks/use-difficulty-label-text'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  sessionId: string
  difficulty: SessionDifficulty | undefined
}

// The difficulty detail sheet behind the session-header stat: the honest
// breakdown (unknown counts, saved-not-started, known marks, the
// vocabulary-only scoping line) plus the "mark the rest as known" sweep CTA —
// a deliberate tap inside a sheet, with the exact count shown on the button
// (the claims-lane posture from phase 1).
export const SessionDifficultySheet = ({ open, onOpenChange, sessionId, difficulty }: Props) => {
  const { t } = useLingui()
  const labelText = useDifficultyLabelText()
  const { data: preview } = useMarkKnownPreview(sessionId, open)
  const { mutate: markRemainingKnown, isPending: isMarking } = useMarkRemainingKnown(sessionId)

  const available = difficulty?.status === 'available' ? difficulty : undefined
  const markableCount = preview?.status === 'ready' ? preview.markableLemmaCount : 0
  const frequentUnknownCount = available?.frequentUnknownCount ?? 0

  const handleMarkKnown = () => {
    markRemainingKnown(
      { sessionId },
      {
        onSuccess: (response) => {
          const markedCount = response.data.markedCount
          toast.success(plural(markedCount, { one: '# word marked as known', other: '# words marked as known' }))
        },
      }
    )
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{t`Vocabulary coverage`}</OverlayTitle>
          <OverlayDescription>
            {t`An estimate of how much of this text's vocabulary you already know. It only measures vocabulary — grammar, speech rate, and abstractness aren't counted.`}
          </OverlayDescription>
        </OverlayHeader>

        <div className='flex flex-col gap-3 px-4 pb-2 sm:px-0'>
          {available && available.expectedCoveragePercent !== null && available.label !== null && (
            <div className='flex items-baseline gap-2'>
              <span className='text-3xl font-bold'>~{available.expectedCoveragePercent}%</span>
              <span className='text-muted-foreground text-sm'>{labelText(available.label)}</span>
            </div>
          )}
          {available && (
            <ul className='text-sm'>
              <li className='flex items-baseline justify-between border-b py-2'>
                <span>{t`Unknown words`}</span>
                <span className='text-muted-foreground'>
                  {available.unknownLemmaCount ?? 0}
                  {frequentUnknownCount > 0 && <> · {t`${frequentUnknownCount} frequent`}</>}
                </span>
              </li>
              <li className='flex items-baseline justify-between border-b py-2'>
                <span>{t`In your vocabulary, not started`}</span>
                <span className='text-muted-foreground'>{available.savedNotStartedCount ?? 0}</span>
              </li>
              <li className='flex items-baseline justify-between py-2'>
                <span>{t`Marked as known`}</span>
                <span className='text-muted-foreground'>{available.knownLemmaCount ?? 0}</span>
              </li>
            </ul>
          )}
          {difficulty?.status === 'pending' && (
            <p className='text-muted-foreground text-sm'>{t`Still analyzing this text — check back in a moment.`}</p>
          )}
          {markableCount > 0 && (
            <p className='text-muted-foreground text-sm'>
              {t`Already know the rest? Marking them as known makes your coverage picture more accurate — you can un-mark any word from its gloss later.`}
            </p>
          )}
        </div>

        <OverlayFooter>
          <Button variant='outline' size='xl' onClick={() => onOpenChange(false)} disabled={isMarking}>
            {t`Close`}
          </Button>
          {markableCount > 0 && (
            <Button size='xl' onClick={handleMarkKnown} disabled={isMarking}>
              {isMarking
                ? t`Marking…`
                : plural(markableCount, {
                    one: 'Mark the remaining # word as known',
                    other: 'Mark the remaining # words as known',
                  })}
            </Button>
          )}
        </OverlayFooter>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
