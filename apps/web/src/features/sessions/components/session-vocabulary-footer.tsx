import { useEffect, useRef, useState } from 'react'
import { BookmarkCheck, Check, ChevronUp, Loader2, WholeWord } from 'lucide-react'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { useProcessStudySession } from '../api/sessions-hooks'
import type { DeclarationPillState } from './declaration-pill-state'

type Props = {
  sessionId: string
  // True while suggestion spans are being generated for the reader's window.
  // Shown as a subtle loader so the multi-second wait doesn't look broken.
  isGeneratingCandidates?: boolean
  onOpenSessionVocabulary?: () => void
  // The declaration pill (docs/READER-SPEC.md): the single ambient entry to
  // the merged checkpoint + mark-known sheet. Derived in session-view via
  // deriveDeclarationPillState.
  pillState: DeclarationPillState
  onOpenDeclarationSheet?: () => void
  // Post-sweep confirmation for the welcome-back card and close-out sweeps
  // (the sheet's own sweeps confirm in-sheet): takes the pill's slot for a few
  // seconds with a sweep-scoped Undo. onUndo is null when the sweep produced
  // no batch to revert.
  sweepConfirmation?: { count: number; onUndo: (() => void) | null } | null
}

// Rolls the pill's count to a new value: the old number slides up and out
// while the new one slides in from below (keyframes in app/index.css). The
// outgoing value needs its own state — the prop alone can't render both
// numbers during the crossfade. Width is reserved via min-w so counts under
// four digits never jitter the pill.
const AnimatedCount = ({ value }: { value: number }) => {
  const { i18n } = useLingui()
  const [display, setDisplay] = useState<{ current: number; previous: number | null }>({
    current: value,
    previous: null,
  })
  // Render-phase adjustment (the "storing information from previous renders"
  // pattern): the outgoing value must survive one animation's worth of time
  // after the prop already moved on.
  if (display.current !== value) {
    setDisplay({ current: value, previous: display.current })
  }
  // Timeout fallback for when animationend never fires (reduced motion).
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (display.previous == null) return
    clearTimerRef.current = setTimeout(() => setDisplay((prev) => ({ ...prev, previous: null })), 600)
    return () => (clearTimerRef.current ? clearTimeout(clearTimerRef.current) : undefined)
  }, [display])

  return (
    <span className='relative inline-block min-w-[2.125rem] overflow-hidden text-center tabular-nums'>
      {display.previous != null && (
        <span key={`out-${display.previous}`} aria-hidden className='count-tick-out absolute inset-0'>
          {i18n.number(display.previous)}
        </span>
      )}
      <span
        key={`in-${display.current}`}
        className={cn('inline-block', display.previous != null && 'count-tick-in')}
        onAnimationEnd={() => setDisplay((prev) => ({ ...prev, previous: null }))}
      >
        {i18n.number(display.current)}
      </span>
    </span>
  )
}

const pillClasses = 'flex h-10 items-center gap-1.5 rounded-full border bg-muted/50 px-3.5 text-sm font-semibold'

const DeclarationPill = ({ state, onOpen }: { state: DeclarationPillState; onOpen?: () => void }) => {
  const { t } = useLingui()

  if (state.kind === 'hidden') return null

  if (state.kind === 'allKnown') {
    return (
      <span className='text-muted-foreground flex h-10 items-center gap-1.5 text-sm font-medium'>
        <Check className='size-4' />
        {t`All known`}
      </span>
    )
  }

  if (state.kind === 'dimmed') {
    return (
      <span aria-hidden className={cn(pillClasses, 'opacity-45')}>
        <WholeWord className='text-muted-foreground size-4' />
        <span className='min-w-[2.125rem] text-center tabular-nums'>0</span>
        <ChevronUp className='text-muted-foreground size-3' />
      </span>
    )
  }

  return (
    <button
      type='button'
      aria-label={state.kind === 'sweep' ? t`Words you've read` : t`I understood up to here`}
      className={cn(pillClasses, 'hover:bg-muted/80 active:bg-muted cursor-pointer transition-colors')}
      onClick={onOpen}
    >
      {state.kind === 'sweep' ? (
        <>
          <WholeWord className='text-muted-foreground size-4' />
          <AnimatedCount value={state.count} />
        </>
      ) : (
        <>
          <BookmarkCheck className='text-muted-foreground size-4' />
          {state.pendingCount > 0 && (
            <span className='min-w-[1.25rem] text-center tabular-nums'>{state.pendingCount}</span>
          )}
        </>
      )}
      <ChevronUp className='text-muted-foreground size-3' />
    </button>
  )
}

export const SessionVocabularyFooter = ({
  sessionId,
  isGeneratingCandidates = false,
  onOpenSessionVocabulary,
  pillState,
  onOpenDeclarationSheet,
  sweepConfirmation = null,
}: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useProcessStudySession(sessionId)

  const label = isPending ? t`Opening…` : t`Session vocabulary`

  // Highlights are enriched in the background as they're selected, so opening
  // Session vocabulary is just a navigation. The click only enqueues background
  // discovery (the backend process route is a near no-op kept for old clients).
  const handleClick = () => {
    mutate({ sessionId }, { onSuccess: () => onOpenSessionVocabulary?.() })
  }

  // One fixed-height row: the reading surface must never shift because of the
  // footer, so nothing here expands in place — the pill opens an overlay. The
  // left slot shows exactly one thing at a time (confirmation > generating >
  // pill) to keep the row stable.
  return (
    <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t p-3 backdrop-blur'>
      <div className='mx-auto flex max-w-4xl items-center justify-between gap-3'>
        <span className='text-muted-foreground flex min-w-0 items-center text-sm'>
          {sweepConfirmation ? (
            <span className='flex items-center gap-2'>
              <span className='flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300'>
                <Check className='size-4 shrink-0' />
                {plural(sweepConfirmation.count, { one: '# word marked as known', other: '# words marked as known' })}
              </span>
              {sweepConfirmation.onUndo && (
                <button
                  type='button'
                  className='hover:text-foreground active:text-foreground cursor-pointer font-medium underline underline-offset-2 transition-colors'
                  onClick={sweepConfirmation.onUndo}
                >
                  {t`Undo`}
                </button>
              )}
            </span>
          ) : isGeneratingCandidates ? (
            <span className='flex items-center gap-1.5 text-amber-700 dark:text-amber-300'>
              <Loader2 className='size-3.5 animate-spin' />
              {t`Finding suggestions…`}
            </span>
          ) : (
            <DeclarationPill state={pillState} onOpen={onOpenDeclarationSheet} />
          )}
        </span>
        <Button size='xl' disabled={isPending} onClick={handleClick} className='shrink-0'>
          {label}
        </Button>
      </div>
    </div>
  )
}
