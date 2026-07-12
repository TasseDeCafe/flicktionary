import { useLingui } from '@lingui/react/macro'
import { Flame } from 'lucide-react'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { Button } from '@flicktionary/ui/components/button'
import type { PracticeQueuePreview } from '../api/practice-hooks'
import { ReviewQueueStats } from './review-queue-stats'

// What pressing the primary Practice button will serve, in the SAME four
// buckets (and the same pill component) as the in-session chips — the numbers
// a user sees here are the numbers the session opens with, because the server
// computes both from one plan. This is the surface that answers "why does the
// session show 20 when the deck has 50 waiting": introductions are throttled
// per session and served behind the warm-up backlog, and this card says so
// with numbers instead of a guide.
export const SessionPlanCard = ({
  preview,
  isLoading,
  isError,
  onRetry,
}: {
  preview: PracticeQueuePreview | undefined
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}) => {
  const { t } = useLingui()

  if (isLoading) {
    return (
      <div className='flex flex-col items-center gap-2 py-1'>
        <Skeleton className='h-6 w-56 rounded-full' />
        <Skeleton className='h-3 w-40' />
      </div>
    )
  }

  if (isError || !preview) {
    return (
      <div className='flex flex-col items-center gap-2 py-1 text-center'>
        <p className='text-muted-foreground text-sm'>{t`Session preview couldn't be loaded.`}</p>
        <Button type='button' variant='outline' size='sm' onClick={onRetry}>
          {t`Try again`}
        </Button>
      </div>
    )
  }

  const { counts, dailyBudget } = preview
  const total = counts.new + counts.warmup + counts.learning + counts.review
  const introducedToday = dailyBudget.introducedToday
  const budgetMax = dailyBudget.max
  const budgetAlreadySpent = dailyBudget.remaining === 0

  return (
    <div className='flex flex-col items-center gap-2 py-1'>
      {total > 0 ? (
        <ReviewQueueStats counts={counts} />
      ) : (
        <p className='text-muted-foreground text-sm'>{t`Nothing to serve right now.`}</p>
      )}
      {/* The budget line makes the daily countdown visible: introductions are
          a per-day allowance, not a per-session one. */}
      {(introducedToday > 0 || counts.new > 0) && (
        <p className='text-muted-foreground text-xs'>
          {budgetAlreadySpent
            ? t`Daily new-term limit reached — more enter tomorrow.`
            : t`${introducedToday} of ${budgetMax} new introductions used today`}
        </p>
      )}
      {budgetAlreadySpent && total === 0 && (
        <div className='flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-300'>
          <Flame className='h-3.5 w-3.5 shrink-0' />
          {t`Today's new-term budget is spent.`}
        </div>
      )}
    </div>
  )
}
