import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Brain, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDueSummary } from '../api/practice-hooks'

export const PracticeLandingView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: summary, isLoading } = useDueSummary()

  const handleStart = (targetLanguage: string) => {
    void navigate({
      to: '/practice/start',
      search: { lang: targetLanguage },
    })
  }

  const singleLanguageReviewable =
    summary && summary.length === 1 && (summary[0]?.dueCount ?? 0) + (summary[0]?.newCount ?? 0) > 0
      ? summary[0]!.targetLanguage
      : null

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6'>
          <header className='flex items-center gap-3'>
            <Brain className='h-7 w-7 text-yellow-500' />
            <h1 className='text-2xl font-bold'>{t`Practice`}</h1>
          </header>

          <p className='text-sm text-gray-600'>
            {t`Read short generated texts that weave in your kept vocabulary. Tap a chunk to rate it; chunks you don't tap are scored as recognized when you advance.`}
          </p>

          {isLoading && <div className='py-8 text-center text-sm text-gray-500'>{t`Loading…`}</div>}

          {!isLoading && (!summary || summary.length === 0) && (
            <div className='rounded-xl border bg-yellow-50 p-6'>
              <h2 className='font-semibold'>{t`No vocabulary to practice yet`}</h2>
              <p className='mt-2 text-sm text-gray-700'>
                {t`Process a session and keep some cards. They'll show up here automatically.`}
              </p>
            </div>
          )}

          {!isLoading && summary && summary.length > 0 && (
            <section className='flex flex-col gap-2'>
              <h2 className='text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase'>{t`Languages`}</h2>
              <div className='divide-y divide-gray-100 overflow-hidden rounded-xl border bg-white'>
                {summary.map((entry) => {
                  const reviewable = entry.dueCount + entry.newCount
                  const totalKept = entry.totalKept
                  const dueCount = entry.dueCount
                  const newCount = entry.newCount
                  const summaryLine =
                    reviewable === 0
                      ? t`All caught up — ${totalKept} card(s) total`
                      : t`${dueCount} due · ${newCount} new · ${totalKept} total`
                  return (
                    <button
                      key={entry.targetLanguage}
                      type='button'
                      disabled={reviewable === 0}
                      onClick={() => handleStart(entry.targetLanguage)}
                      className='flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50'
                    >
                      <div className='flex min-w-0 flex-1 flex-col'>
                        <span className='truncate text-sm font-medium uppercase'>{entry.targetLanguage}</span>
                        <span className='text-muted-foreground truncate text-xs'>{summaryLine}</span>
                      </div>
                      {reviewable > 0 && <ChevronRight className='h-5 w-5 text-gray-400' />}
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {singleLanguageReviewable && (
        <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 p-3 backdrop-blur'>
          <div className='mx-auto flex w-full max-w-2xl items-center md:justify-end'>
            <Button className='w-full md:w-auto' onClick={() => handleStart(singleLanguageReviewable)}>
              {t`Start practice`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
