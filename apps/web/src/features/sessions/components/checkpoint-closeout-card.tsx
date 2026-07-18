import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { BookmarkCheck, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'

type Props = {
  pendingCount: number
  // The reviewed-until pointer already sits at the end of the track.
  isCollected: boolean
  isCollecting: boolean
  onCollect: () => void
  // Backlog candidates from the LAST collect (this mount) — the claims
  // re-entry after the toast is gone. 0 hides the affordance.
  claimsCount: number
  onOpenClaims: () => void
}

// End-of-content close-out (docs/READER-SPEC.md): the common case is finishing
// the text/episode, so the checkpoint press gets a fuller presentation here —
// available whenever the end is reached, even at zero pending reviews (a
// zero-review close-out can still surface backlog claims; this is the
// discovery path the footer's count-gated button can't provide).
export const CheckpointCloseoutCard = ({
  pendingCount,
  isCollected,
  isCollecting,
  onCollect,
  claimsCount,
  onOpenClaims,
}: Props) => {
  const { t } = useLingui()

  return (
    <div className='mx-auto my-6 max-w-md rounded-xl border p-4 text-center'>
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
                  one: 'Confirm you followed along to collect # review.',
                  other: 'Confirm you followed along to collect # reviews.',
                })
              : t`Confirm you followed along — words you already know may be waiting.`}
          </p>
          <Button size='xl' className='mt-3 w-full' disabled={isCollecting} onClick={onCollect}>
            {isCollecting ? (
              <>
                <Loader2 className='size-4 animate-spin' />
                {t`Collecting…`}
              </>
            ) : (
              t`I've followed to the end`
            )}
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
    </div>
  )
}
