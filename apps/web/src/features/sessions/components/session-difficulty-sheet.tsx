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
  // The reader's furthest-read pointer + the track's last index: mid-text they
  // scope the primary sweep to "what you've read so far" (the progressive
  // multi-sitting flow); read-to-the-end (or never scrolled) falls back to the
  // whole-text sweep alone.
  furthestReadSegmentIndex: number | null
  maxSegmentIndex: number | null
}

// The difficulty detail sheet behind the session-header stat: the honest
// breakdown (unknown counts, saved-not-started, known marks, the
// vocabulary-only scoping line) plus the mark-known sweep CTAs — deliberate
// taps inside a sheet, with the exact preview count on the button (the
// claims-lane posture from phase 1). Mid-text the primary CTA covers the read
// span; the whole-text sweep stays available as a secondary action.
export const SessionDifficultySheet = ({
  open,
  onOpenChange,
  sessionId,
  difficulty,
  furthestReadSegmentIndex,
  maxSegmentIndex,
}: Props) => {
  const { t } = useLingui()
  const labelText = useDifficultyLabelText()

  const hasPartialRead =
    furthestReadSegmentIndex != null && maxSegmentIndex != null && furthestReadSegmentIndex < maxSegmentIndex
  const { data: wholePreview } = useMarkKnownPreview(sessionId, open)
  const { data: spanPreview } = useMarkKnownPreview(sessionId, open && hasPartialRead, furthestReadSegmentIndex)
  const { mutate: markRemainingKnown, isPending: isMarking } = useMarkRemainingKnown(sessionId)

  const available = difficulty?.status === 'available' ? difficulty : undefined
  const wholeCount = wholePreview?.status === 'ready' ? wholePreview.markableLemmaCount : 0
  const spanCount = hasPartialRead && spanPreview?.status === 'ready' ? spanPreview.markableLemmaCount : 0
  const frequentUnknownCount = available?.frequentUnknownCount ?? 0

  const handleMarkKnown = (toSegmentIndex: number | null) => {
    markRemainingKnown(
      { sessionId, ...(toSegmentIndex != null ? { toSegmentIndex } : {}) },
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
          {(spanCount > 0 || wholeCount > 0) && (
            <p className='text-muted-foreground text-sm'>
              {hasPartialRead
                ? t`Already know the words you've read? Mark them as known — come back after your next sitting to mark further. You can un-mark any word from its gloss later.`
                : t`Already know the rest? Marking them as known makes your coverage picture more accurate — you can un-mark any word from its gloss later.`}
            </p>
          )}
          {hasPartialRead && wholeCount > 0 && (
            <button
              type='button'
              className='text-muted-foreground hover:text-foreground w-fit text-sm underline underline-offset-2 disabled:opacity-50'
              disabled={isMarking}
              onClick={() => handleMarkKnown(null)}
            >
              {plural(wholeCount, {
                one: 'Or mark the whole text (# word)',
                other: 'Or mark the whole text (# words)',
              })}
            </button>
          )}
        </div>

        <OverlayFooter>
          <Button variant='outline' size='xl' onClick={() => onOpenChange(false)} disabled={isMarking}>
            {t`Close`}
          </Button>
          {/* While partially read, the primary slot belongs to the span sweep
              alone — when the read span is fully swept (spanCount 0) it stays
              empty rather than falling through to the whole-text sweep, which
              would silently promote "assert the words I have NOT read" to the
              primary action. The whole-text sweep remains the demoted text
              action above. */}
          {hasPartialRead
            ? spanCount > 0 && (
                <Button size='xl' onClick={() => handleMarkKnown(furthestReadSegmentIndex)} disabled={isMarking}>
                  {isMarking
                    ? t`Marking…`
                    : plural(spanCount, {
                        one: 'Mark the # word read so far as known',
                        other: 'Mark the # words read so far as known',
                      })}
                </Button>
              )
            : wholeCount > 0 && (
                <Button size='xl' onClick={() => handleMarkKnown(null)} disabled={isMarking}>
                  {isMarking
                    ? t`Marking…`
                    : plural(wholeCount, {
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
