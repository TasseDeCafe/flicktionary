import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { Button } from '@flicktionary/ui/components/button'

type Props = {
  // Unswept words in the span read up to the mount's opening pointer — LAST
  // sitting's words, never the live pointer's.
  count: number
  // The furthest-read line's timestamp ("24:10"); null for untimed text tracks.
  untilLabel: string | null
  isMarking: boolean
  onMarkKnown: () => void
  onDismiss: () => void
}

// The welcome-back offer: shown once per mount when the reader returns to a
// partially-read session with enough unswept read words. Rendered inline below
// the "read up to here" divider, so it's the first thing met when reading
// resumes and it scrolls away with the text. "Not yet" dismisses for this
// sitting only — the offer returns next visit while unswept words remain.
export const WelcomeBackCard = ({ count, untilLabel, isMarking, onMarkKnown, onDismiss }: Props) => {
  const { t } = useLingui()
  return (
    <div className='bg-muted/30 mx-auto my-3 w-full max-w-md rounded-xl border p-4'>
      <div className='text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase'>{t`Last sitting`}</div>
      <p className='mt-1.5 text-sm'>
        {untilLabel
          ? plural(count, {
              one: `You read # new word, up to ${untilLabel}. Already know it?`,
              other: `You read # new words, up to ${untilLabel}. Already know them?`,
            })
          : plural(count, {
              one: 'You read # new word last time. Already know it?',
              other: 'You read # new words last time. Already know them?',
            })}
      </p>
      <div className='mt-3 flex gap-2'>
        <Button variant='outline' className='flex-1' onClick={onDismiss}>
          {t`Not yet`}
        </Button>
        <Button className='flex-1' disabled={isMarking} onClick={onMarkKnown}>
          {isMarking ? t`Marking…` : t`Mark as known`}
        </Button>
      </div>
    </div>
  )
}
