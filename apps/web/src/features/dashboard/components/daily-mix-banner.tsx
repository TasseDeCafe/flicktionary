import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ArrowRight, Brain, CircleCheck } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { DEFAULT_PRACTICE_QUEUE_FILTER } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { useDueSummary, usePreviewPracticeQueues } from '@/features/practice/api/practice-hooks'
import { orderMixLanguages, plannedTotal, truncateMixChips } from '@/features/practice/utils/daily-mix'

// The Daily Mix CTA: one Start that clears every language's queue in sequence.
// Numbers come from the same session-plan previews the per-language practice
// landing shows (shared cache entries), so entering a language never surprises.
// The chip row reads as a queue — ordered most-recently-practiced first — not
// a single-language shortcut. With one language it degrades to a plain
// practice button (no mix param, no interstitials).
export const DailyMixBanner = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: summary, isLoading: isSummaryLoading } = useDueSummary()

  const ordered = useMemo(() => orderMixLanguages(summary ?? []), [summary])
  const languages = useMemo(() => ordered.map((entry) => entry.targetLanguage), [ordered])
  const previews = usePreviewPracticeQueues(languages)

  if (isSummaryLoading || previews.some((query) => query.isLoading)) return <DailyMixBannerSkeleton />
  if (!summary || summary.length === 0) return null

  // A failed preview must never silently render as zero — that would break the
  // no-surprises parity with the practice landing.
  const failed = previews.filter((query) => query.isError)
  if (failed.length > 0) {
    return (
      <div className='bg-card mt-4 flex items-center justify-between gap-3 rounded-xl border p-3'>
        <p className='text-muted-foreground text-sm'>{t`Couldn't load your practice queue.`}</p>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => failed.forEach((query) => void query.refetch())}
        >
          {t`Retry`}
        </Button>
      </div>
    )
  }

  const entries = languages
    .map((targetLanguage, i) => {
      const counts = previews[i]?.data?.counts
      return { targetLanguage, planned: counts ? plannedTotal(counts) : 0 }
    })
    .filter((entry) => entry.planned > 0)
  const total = entries.reduce((sum, entry) => sum + entry.planned, 0)

  // The slot stays put at zero so the CTA's location is learnable and the
  // layout doesn't jump between days.
  if (total === 0) {
    return (
      <div className='bg-card mt-4 flex items-center gap-2 rounded-xl border p-3'>
        <CircleCheck className='h-5 w-5 shrink-0 text-emerald-600' />
        <p className='text-muted-foreground text-sm'>{t`All caught up for today.`}</p>
      </div>
    )
  }

  const mixLanguages = entries.map((entry) => entry.targetLanguage)
  const languageCount = mixLanguages.length
  const firstLanguageName = getLanguageName(mixLanguages[0])
  const subtitle =
    languageCount > 1 ? t`${total} cards across ${languageCount} languages` : t`${total} cards in ${firstLanguageName}`
  const { visible, hiddenCount } = truncateMixChips(entries)

  const start = () =>
    void navigate({
      to: '/practice/composed/$targetLanguage',
      params: { targetLanguage: mixLanguages[0] },
      // Single language: a plain default session, exactly the landing's
      // Practice button — the mix chain only exists with 2+ languages.
      search: { ...DEFAULT_PRACTICE_QUEUE_FILTER, mix: languageCount > 1 ? mixLanguages : undefined },
    })

  return (
    // One wrapping row: on desktop the chip chain sits right-aligned next to
    // Start; on mobile it drops to its own full-width line below (order-last
    // + w-full force the wrap).
    <div className='mt-4 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl bg-yellow-100 p-4 dark:bg-yellow-400/10'>
      <div className='bg-background flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-yellow-900 dark:text-yellow-300'>
        <Brain className='h-5 w-5' />
      </div>
      <div className='min-w-0 flex-1 md:flex-none'>
        <div className='text-sm font-bold'>{t`Your next session`}</div>
        <div className='text-xs text-yellow-900 dark:text-yellow-300'>{subtitle}</div>
      </div>
      {languageCount > 1 && (
        <div className='flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2 max-md:order-last md:ml-auto md:w-auto md:justify-end'>
          {visible.map((entry, i) => (
            <span key={entry.targetLanguage} className='flex items-center gap-1.5'>
              {i > 0 && <ArrowRight strokeWidth={3} className='h-3 w-3 text-yellow-700 dark:text-yellow-400' />}
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${
                  i === 0 ? 'bg-foreground text-background' : 'bg-background text-yellow-900 dark:text-yellow-300'
                }`}
              >
                {entry.targetLanguage.toUpperCase()} {entry.planned}
              </span>
            </span>
          ))}
          {hiddenCount > 0 && (
            <span className='text-xs font-semibold text-yellow-900 dark:text-yellow-300'>{t`+${hiddenCount} more`}</span>
          )}
        </div>
      )}
      {/* With chips, the chip row's ml-auto owns the free space and Start
          rides right beside it; a second ml-auto here would split the space
          and re-center the chips, so it only applies in the chipless case. */}
      <Button
        type='button'
        className={cn('shrink-0 rounded-full px-6 max-md:h-10', languageCount <= 1 && 'md:ml-auto')}
        onClick={start}
      >
        {t`Start`}
      </Button>
    </div>
  )
}

const DailyMixBannerSkeleton = () => (
  <div className='mt-4 flex items-center gap-3 rounded-xl border p-4'>
    <Skeleton className='h-9 w-9 rounded-lg' />
    <div className='flex flex-1 flex-col gap-2'>
      <Skeleton className='h-4 w-32' />
      <Skeleton className='h-3 w-44' />
    </div>
    <Skeleton className='h-10 w-24 rounded-full md:h-9' />
  </div>
)
