import { useLingui } from '@lingui/react/macro'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import type { QueueCounts } from './review-counts'

// Remaining-count chips for a practice queue, bucketed by learning stage (see
// QueueCounts). Each chip is a press target opening a short explanation —
// click/tap only, no hover trigger: the chips sit right next to the answer
// buttons, and a popover firing on a stray hover there would be constant
// accidental noise.
export const ReviewQueueStats = ({ counts }: { counts: QueueCounts }) => {
  const { t } = useLingui()
  const items = [
    {
      key: 'new',
      label: t`New`,
      description: t`Terms introduced for the first time in this session.`,
      value: counts.new,
      className: 'bg-blue-50 text-blue-700 ring-blue-100 hover:bg-blue-100 active:bg-blue-100',
      dotClassName: 'bg-blue-500',
    },
    // The warm-up pill hides at 0 rather than showing dead weight: reading
    // mode and gate-free sessions never serve returning warm-up gates, and a
    // phone-width bottom bar barely fits four pills.
    ...(counts.warmup > 0
      ? [
          {
            key: 'warmup',
            label: t`Warm-up`,
            description: t`Returning warm-up exercises for recently introduced terms — a few correct days graduate them to flashcards.`,
            value: counts.warmup,
            className: 'bg-amber-50 text-amber-700 ring-amber-100 hover:bg-amber-100 active:bg-amber-100',
            dotClassName: 'bg-amber-500',
          },
        ]
      : []),
    {
      key: 'learning',
      label: t`Learning`,
      description: t`Terms you're still working on: recently introduced, recently missed, or in rehab exercises.`,
      value: counts.learning,
      className: 'bg-rose-50 text-rose-700 ring-rose-100 hover:bg-rose-100 active:bg-rose-100',
      dotClassName: 'bg-rose-500',
    },
    {
      key: 'review',
      label: t`Review`,
      description: t`Terms coming back for their scheduled review.`,
      value: counts.review,
      className: 'bg-emerald-50 text-emerald-700 ring-emerald-100 hover:bg-emerald-100 active:bg-emerald-100',
      dotClassName: 'bg-emerald-500',
    },
  ]

  return (
    <div className='flex items-center justify-center gap-2' aria-label={t`Cards left`}>
      {items.map((item) => (
        <Popover key={item.key}>
          <PopoverTrigger asChild>
            <button
              type='button'
              className={`flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors sm:px-3 ${item.className}`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dotClassName}`} />
              <span className='tabular-nums'>{item.value.toLocaleString()}</span>
              {/* The label collapses to screen-reader-only below sm: three
                  labeled pills plus the peek chevrons don't fit a phone-width
                  bottom bar (and translated labels run longer than English). */}
              <span className='sr-only sm:not-sr-only'>{item.label}</span>
            </button>
          </PopoverTrigger>
          {/* The label repeats as the popover title — on mobile the pill shows
              only the dot + count, so the popover is where the name lives. */}
          <PopoverContent side='top' align='center' className='w-60 p-3'>
            <p className='text-sm font-medium'>{item.label}</p>
            <p className='text-muted-foreground mt-1 text-sm'>{item.description}</p>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  )
}
