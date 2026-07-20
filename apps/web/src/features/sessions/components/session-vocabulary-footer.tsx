import { useState } from 'react'
import { BookmarkCheck, Check, ChevronUp, Loader2 } from 'lucide-react'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import { useProcessStudySession } from '../api/sessions-hooks'
import { CheckpointInfoPopover } from './checkpoint-info-popover'

type Props = {
  sessionId: string
  // True while suggestion spans are being generated for the reader's window.
  // Shown as a subtle loader so the multi-second wait doesn't look broken.
  isGeneratingCandidates?: boolean
  onOpenSessionVocabulary?: () => void
  // Checkpoint reviews (docs/READER-SPEC.md). The button renders when
  // pending + backlog > 0 — not pending alone, or backlog-only spans would
  // stay undiscoverable. Omitted entirely (undefined handler) for unsupported
  // languages.
  checkpointPendingCount?: number
  checkpointBacklogCount?: number
  onCollectCheckpoint?: () => void
  isCollectingCheckpoint?: boolean
  // Mark-known dock (docs/READER-SPEC.md): the quiet mid-text entry to the
  // sweep. The resting line deliberately carries no number — the count appears
  // only inside the opened panel, next to the deliberate button. 0 hides it.
  markKnownDockCount?: number
  onMarkKnown?: () => void
  isMarkingKnown?: boolean
  // Post-sweep confirmation: takes the dock line's slot for a few seconds with
  // a sweep-scoped Undo, then the footer returns to resting. onUndo is null
  // when the sweep produced no batch to revert.
  sweepConfirmation?: { count: number; onUndo: (() => void) | null } | null
}

export const SessionVocabularyFooter = ({
  sessionId,
  isGeneratingCandidates = false,
  onOpenSessionVocabulary,
  checkpointPendingCount = 0,
  checkpointBacklogCount = 0,
  onCollectCheckpoint,
  isCollectingCheckpoint = false,
  markKnownDockCount = 0,
  onMarkKnown,
  isMarkingKnown = false,
  sweepConfirmation = null,
}: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useProcessStudySession(sessionId)
  const [dockOpen, setDockOpen] = useState(false)

  const label = isPending ? t`Opening…` : t`Session vocabulary`

  // Highlights are enriched in the background as they're selected, so opening
  // Session vocabulary is just a navigation. The click only enqueues background
  // discovery (the backend process route is a near no-op kept for old clients).
  const handleClick = () => {
    mutate({ sessionId }, { onSuccess: () => onOpenSessionVocabulary?.() })
  }

  // The label is the comprehension assertion, not the reward — the pending
  // count rides along as a passive badge and "N reviews collected" is the
  // result toast, so the button never invites pressing without the assertion
  // being true. The (i) popover explains what the press actually does.
  const showCheckpoint = !!onCollectCheckpoint && checkpointPendingCount + checkpointBacklogCount > 0

  // The confirmation strip owns the slot while present, so the offer and its
  // outcome never show at once.
  const showDock = !sweepConfirmation && markKnownDockCount > 0 && !!onMarkKnown

  return (
    <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t p-3 backdrop-blur'>
      <div className='mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3'>
        {/* Kept even when empty so justify-between keeps the buttons on the
            right. The highlight count lives in the reader header. */}
        <span className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'>
          {sweepConfirmation && (
            <span className='flex items-center gap-2'>
              <span className='flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300'>
                <Check className='size-4' />
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
          )}
          {showDock && (
            <Popover open={dockOpen} onOpenChange={setDockOpen}>
              <PopoverTrigger asChild>
                <button
                  type='button'
                  className='hover:text-foreground active:text-foreground flex cursor-pointer items-center gap-1.5 transition-colors'
                >
                  {t`Already know the words you've read?`}
                  <ChevronUp className={cn('size-3.5 transition-transform', dockOpen && 'rotate-180')} />
                </button>
              </PopoverTrigger>
              <PopoverContent align='start' side='top' className='w-80'>
                <div className='text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase'>
                  {t`Words you've read`}
                </div>
                <p className='mt-2 text-sm'>
                  {plural(markKnownDockCount, {
                    one: "You've read # word that isn't marked as known yet.",
                    other: "You've read # words that aren't marked as known yet.",
                  })}
                </p>
                <Button
                  className='mt-3 w-full'
                  disabled={isMarkingKnown}
                  onClick={() => {
                    setDockOpen(false)
                    onMarkKnown?.()
                  }}
                >
                  {isMarkingKnown
                    ? t`Marking…`
                    : plural(markKnownDockCount, { one: 'Mark the # word as known', other: 'Mark all # as known' })}
                </Button>
                <p className='text-muted-foreground mt-2 text-center text-xs'>{t`You can un-mark any word later.`}</p>
              </PopoverContent>
            </Popover>
          )}
          {isGeneratingCandidates && (
            <span className='flex items-center gap-1.5 text-amber-700 dark:text-amber-300'>
              <Loader2 className='size-3.5 animate-spin' />
              {t`Finding suggestions…`}
            </span>
          )}
        </span>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          {showCheckpoint && (
            <div className='flex w-full items-center gap-1 sm:w-auto'>
              <Button
                size='xl'
                variant='secondary'
                disabled={isCollectingCheckpoint}
                onClick={onCollectCheckpoint}
                className='flex-1'
              >
                {isCollectingCheckpoint ? (
                  <Loader2 className='size-4 animate-spin' />
                ) : (
                  <BookmarkCheck className='size-4' />
                )}
                {t`I understood up to here`}
                {checkpointPendingCount > 0 && (
                  <span className='bg-foreground/10 ml-1 rounded-full px-2 py-0.5 text-xs tabular-nums'>
                    {checkpointPendingCount}
                  </span>
                )}
              </Button>
              <CheckpointInfoPopover />
            </div>
          )}
          <Button size='xl' disabled={isPending} onClick={handleClick} className='w-full sm:w-auto'>
            {label}
          </Button>
        </div>
      </div>
    </div>
  )
}
