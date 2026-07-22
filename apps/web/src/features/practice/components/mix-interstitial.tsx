import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { Check, Dumbbell, Loader2 } from 'lucide-react'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { SuccessCheck } from '@/components/ui/success-check'
import { usePreviewPracticeQueue } from '../api/practice-hooks'
import { plannedTotal, type MixRecap } from '../utils/daily-mix'

type MixInterstitialProps = {
  // The language whose session just finished.
  targetLanguage: string
  done: string[]
  upcoming: string[]
  recap: MixRecap
  hardCount: number
  // Ratings still settling server-side — the tally would undercount and a
  // navigation could lose a failed rating's requeue, so actions wait.
  isSettling: boolean
  onStrengthen: () => void
  onContinue: () => void
  onExit: () => void
  showKbd: boolean
}

// The breather between Daily Mix languages: recap of the finished language,
// the chain's progress, and the next language's card. "Done for now" exits
// with progress kept — ratings are already persisted per card, so the banner
// simply re-derives the remaining chain next time.
export const MixInterstitial = ({
  targetLanguage,
  done,
  upcoming,
  recap,
  hardCount,
  isSettling,
  onStrengthen,
  onContinue,
  onExit,
  showKbd,
}: MixInterstitialProps) => {
  const { t } = useLingui()
  const languageName = getLanguageName(targetLanguage)
  const nextLanguage = upcoming[0]
  const nextName = getLanguageName(nextLanguage)
  // The next language's session-plan preview — the same query (and cache
  // entry) the Daily Mix banner and the practice landing use, so the number
  // promised here is the number the next compose actually serves. The raw due
  // summary would overpromise: its warm-up count is the whole ladder backlog,
  // not the few gates a session serves.
  const { data: nextPreview } = usePreviewPracticeQueue(nextLanguage ?? null)
  const nextTotal = nextPreview ? plannedTotal(nextPreview.counts) : 0
  const nextLine = nextPreview && nextTotal > 0 ? plural(nextTotal, { one: '# card', other: '# cards' }) : null

  const cardsDone = recap.cardsDone
  const newIntroduced = recap.newIntroduced
  const warmedUp = recap.warmedUp
  const recapParts = [
    t`${cardsDone} cards`,
    ...(newIntroduced > 0 ? [t`${newIntroduced} new introduced`] : []),
    ...(warmedUp > 0 ? [t`${warmedUp} warmed up`] : []),
  ]

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 text-center'>
        <div className='flex flex-col items-center gap-3'>
          <SuccessCheck />
          <p className='text-2xl font-bold'>{t`${languageName} — done`}</p>
          {isSettling ? (
            <p className='text-muted-foreground flex items-center gap-2 text-sm'>
              <Loader2 className='h-4 w-4 animate-spin' />
              {t`Saving your ratings…`}
            </p>
          ) : (
            <p className='text-muted-foreground text-sm'>{recapParts.join(' · ')}</p>
          )}
        </div>

        {/* The chain: finished languages (incl. this one) get a check, the next
            one is highlighted, the rest wait their turn. */}
        <div className='flex flex-wrap items-center justify-center gap-2'>
          {[...done, targetLanguage].map((code) => (
            <span
              key={code}
              className='flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300'
            >
              {code.toUpperCase()}
              <Check className='h-3 w-3' strokeWidth={3} />
            </span>
          ))}
          {upcoming.map((code, i) => (
            <span
              key={code}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold',
                i === 0 ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
              )}
            >
              {code.toUpperCase()}
            </span>
          ))}
        </div>
      </div>

      {/* "Up next" lives with the actions, not as a floating card mid-screen —
          a bordered card there reads as pressable when only the buttons act. */}
      <div className='bg-background border-t px-4 pt-3 pb-3'>
        <div className='mx-auto flex w-full max-w-xl flex-col gap-2'>
          <div className='pb-1'>
            <div className='text-muted-foreground text-xs font-semibold tracking-widest uppercase'>{t`Up next`}</div>
            <div className='mt-1 text-lg font-bold'>
              {nextName}
              {nextLine != null && <span className='text-muted-foreground text-sm font-normal'> · {nextLine}</span>}
            </div>
          </div>
          <Button type='button' size='xl' className='w-full' disabled={isSettling} onClick={onContinue}>
            {t`Continue with ${nextName}`}
            {showKbd && <Kbd>↵</Kbd>}
          </Button>
          {hardCount > 0 && (
            <Button
              type='button'
              variant='outline'
              size='xl'
              className='w-full'
              disabled={isSettling}
              onClick={onStrengthen}
            >
              <Dumbbell className='h-4 w-4' />
              {t`Strengthen ${languageName} first`}
            </Button>
          )}
          <Button type='button' variant='ghost' size='xl' className='w-full' disabled={isSettling} onClick={onExit}>
            {t`Done for now`}
          </Button>
        </div>
      </div>
    </div>
  )
}
