import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { BookmarkCheck, CheckCircle2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { CheckpointInfoPopover } from './checkpoint-info-popover'

type Props = {
  pendingCount: number
  // The reviewed-until pointer already sits at the end of the track.
  isCollected: boolean
  // Opens the declaration sheet: the reviews list, then the saved words never
  // practiced, then the mark-known sweep.
  onCollect: () => void
  // Never-practiced candidates the latest checkpoint left unasserted — the
  // re-entry to the sheet's claims step. 0 hides the affordance.
  claimsCount: number
  onOpenClaims: () => void
  // Mark-known sweep rider (docs/READER-SPEC.md): the whole-text sweep offered
  // at the natural "finished the text" moment. 0 hides the section — including
  // while the preview loads or the lemma profile is unavailable.
  markKnownCount: number
  isMarkingKnown: boolean
  onMarkKnown: () => void
}

// End-of-content close-out (docs/READER-SPEC.md): the common case is finishing
// the text/episode, so the declaration sheet gets a fuller entry point here —
// available whenever the end is reached, even at zero pending reviews (a
// zero-review close-out can still surface never-practiced words; this is the
// discovery path the footer's count-gated pill can't provide). The mark-known
// rider stays a one-tap sweep.
export const CheckpointCloseoutCard = ({
  pendingCount,
  isCollected,
  onCollect,
  claimsCount,
  onOpenClaims,
  markKnownCount,
  isMarkingKnown,
  onMarkKnown,
}: Props) => {
  const { t } = useLingui()

  return (
    <div className='relative mx-auto my-6 max-w-md rounded-xl border p-4 text-center'>
      {!isCollected && <CheckpointInfoPopover className='absolute top-2 right-2' />}
      {isCollected ? (
        <>
          <CheckCircle2 className='text-muted-foreground mx-auto size-6' />
          <p className='mt-2 text-sm font-medium'>{t`You've reached the end`}</p>
          <p className='text-muted-foreground mt-1 text-sm'>{t`Reviews collected for everything you've read.`}</p>
        </>
      ) : (
        <>
          <BookmarkCheck className='text-muted-foreground mx-auto size-6' />
          <p className='mt-2 text-sm font-medium'>{t`You've reached the end`}</p>
          <p className='text-muted-foreground mt-1 text-sm'>
            {pendingCount > 0
              ? plural(pendingCount, {
                  one: 'Confirm you understood what you read to collect # review.',
                  other: 'Confirm you understood what you read to collect # reviews.',
                })
              : t`Confirm you understood what you read — words you already know may be waiting.`}
          </p>
          <Button size='xl' className='mt-3 w-full' onClick={onCollect}>
            {t`I understood everything`}
          </Button>
        </>
      )}
      {claimsCount > 0 && (
        <Button variant='outline' size='xl' className='mt-3 w-full' onClick={onOpenClaims}>
          {plural(claimsCount, {
            one: '# word you may already know',
            other: '# words you may already know',
          })}
        </Button>
      )}
      {markKnownCount > 0 && (
        <div className='mt-4 border-t pt-3'>
          <p className='text-sm'>
            {plural(markKnownCount, {
              one: 'Already know the # remaining word?',
              other: 'Already know the # remaining words?',
            })}
          </p>
          <Button variant='outline' size='xl' className='mt-2 w-full' disabled={isMarkingKnown} onClick={onMarkKnown}>
            {isMarkingKnown ? t`Marking…` : t`Mark as known`}
          </Button>
          <p className='text-muted-foreground mt-2 text-xs'>{t`You can un-mark any word later.`}</p>
        </div>
      )}
    </div>
  )
}
