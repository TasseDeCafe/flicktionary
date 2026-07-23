import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  OverlayDescription,
  OverlayFooter,
} from '@/components/ui/responsive-overlay'
import { useMarkKnownPreview } from '../api/sessions-hooks'
import {
  declarationSheetStepIndicator,
  initialDeclarationSheetState,
  reduceDeclarationSheet,
  reduceUndoOutcome,
  type DeclarationSheetEvent,
} from '@flicktionary/core/utils/checkpoint-sweep-sheet-state'

// One frontier per run: captured by session-view when the pill is pressed, so
// the collect and the sweep commit exactly the range the sheet displays — the
// footer's debounced count can lag the live pointer.
export type DeclarationRun = {
  toSegmentIndex: number
  checkpointIncluded: boolean
  sweepIncluded: boolean
}

export type CollectOutcome =
  { ok: true; checkpointId: string | null; creditedCount: number } | { ok: false; reason: 'conflict' | 'error' }

export type SweepOutcome = { ok: true; markedCount: number; sweepBatchId: string | null } | { ok: false }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  // Kept non-null through the closing animation; only a new open replaces it.
  run: DeclarationRun | null
  checkpointPendingCount: number
  // Async operations owned by session-view (they carry the previewedSpans /
  // claims bookkeeping). All of them read the run snapshot through a ref, so
  // a conflict re-snapshot is visible without waiting for a re-render.
  onCollect: () => Promise<CollectOutcome>
  // A collect CONFLICT means the pointer moved under us — re-snapshot the run
  // to the fresh pointer before retrying.
  onRefreshSnapshot: () => void
  onSweep: () => Promise<SweepOutcome>
  onUndoSweep: (sweepBatchId: string) => Promise<boolean>
  onUndoCheckpoint: (checkpointId: string) => Promise<{ ok: boolean; undone: boolean }>
}

const DONE_AUTO_CLOSE_MS = 4000

// The merged declaration flow (docs/READER-SPEC.md): checkpoint → optional
// mark-known sweep → done, in one overlay (mobile drawer / desktop dialog) so
// the reading surface never moves. Step state lives in the pure reducer in
// checkpoint-sweep-sheet-state.ts. The parent remounts this component (a
// fresh `key`) on every open, so all run state initializes here — a conflict
// re-snapshot only swaps the `run` prop and never restarts the machine.
export const CheckpointSweepSheet = ({
  open,
  onOpenChange,
  sessionId,
  run,
  checkpointPendingCount,
  onCollect,
  onRefreshSnapshot,
  onSweep,
  onUndoSweep,
  onUndoCheckpoint,
}: Props) => {
  const { t } = useLingui()
  const [state, setState] = useState(() =>
    initialDeclarationSheetState(run ?? { checkpointIncluded: true, sweepIncluded: true })
  )
  const dispatch = (event: DeclarationSheetEvent) => setState((prev) => reduceDeclarationSheet(prev, event))
  // True while a mutation is in flight — dismissal is blocked so the overlay
  // can't vanish mid-write.
  const [busy, setBusy] = useState(false)
  // A non-conflict collect failure: inline, retryable by pressing Confirm again.
  const [collectFailed, setCollectFailed] = useState(false)

  // The authoritative count for THIS run's span — the footer pill shows a
  // debounced approximation; the sweep step must promise exactly what the
  // mutation will insert.
  const previewQuery = useMarkKnownPreview(sessionId, open && !!run?.sweepIncluded, run?.toSegmentIndex)
  const exactCount = previewQuery.data?.status === 'ready' ? previewQuery.data.markableLemmaCount : null

  // The sweep step evaporates when its exact count resolves to 0 (the pill's
  // debounced count over-promised): a run that already checkpointed jumps to
  // done; a sweep-only run has nothing left to show and closes.
  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-chain-state-updates, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- the trigger is the span preview QUERY resolving to 0 (async server data), not a user event; there is no handler this could live in */
    if (!open || busy || state.phase !== 'sweep' || exactCount !== 0) return
    if (state.checkpoint) {
      dispatch({ type: 'skipSweep' })
    } else {
      onOpenChange(false)
    }
    /* eslint-enable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-chain-state-updates, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change */
  }, [open, busy, state.phase, state.checkpoint, exactCount, onOpenChange])

  // Auto-close the done screen — cancelled while an undo is running.
  useEffect(() => {
    if (!open || busy || state.phase !== 'done') return
    const timer = setTimeout(() => onOpenChange(false), DONE_AUTO_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [open, busy, state.phase, onOpenChange])

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return
    onOpenChange(next)
  }

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    setCollectFailed(false)
    try {
      const outcome = await onCollect()
      if (outcome.ok) {
        dispatch({ type: 'collected', checkpointId: outcome.checkpointId, creditedCount: outcome.creditedCount })
      } else if (outcome.reason === 'conflict') {
        dispatch({ type: 'collectConflict' })
      } else {
        setCollectFailed(true)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleConflictRetry = () => {
    onRefreshSnapshot()
    dispatch({ type: 'collectRetry' })
    void handleConfirm()
  }

  const handleSweep = async () => {
    if (busy) return
    setBusy(true)
    try {
      const outcome = await onSweep()
      // Failure already toasted by the mutation's meta — stay on the step so
      // the reader can retry or skip.
      if (outcome.ok) dispatch({ type: 'swept', markedCount: outcome.markedCount, sweepBatchId: outcome.sweepBatchId })
    } finally {
      setBusy(false)
    }
  }

  // The combined Undo: two independent endpoints, attempted sequentially and
  // both reported — a partial failure keeps the sheet open and says what was
  // NOT reverted. On a retry from the undoError screen only the failed parts
  // re-run (a stale checkpoint is not retryable — a newer checkpoint exists).
  const handleUndo = async () => {
    if (busy) return
    const retrying = state.phase === 'undoError'
    const sweepBatchId = state.sweep?.sweepBatchId ?? null
    const checkpointId = state.checkpoint?.checkpointId ?? null
    const doSweep = sweepBatchId != null && (!retrying || state.undo?.sweepFailed === true)
    const doCheckpoint = checkpointId != null && (!retrying || state.undo?.checkpointFailed === true)
    setBusy(true)
    try {
      let sweepOk = true
      if (doSweep && sweepBatchId) sweepOk = await onUndoSweep(sweepBatchId)
      let checkpointOk = true
      let checkpointUndone = true
      if (doCheckpoint && checkpointId) {
        const result = await onUndoCheckpoint(checkpointId)
        checkpointOk = result.ok
        checkpointUndone = result.undone
      }
      const { fullSuccess, event } = reduceUndoOutcome({
        sweepAttempted: doSweep,
        sweepOk,
        checkpointAttempted: doCheckpoint,
        checkpointOk,
        checkpointUndone,
      })
      if (fullSuccess) {
        onOpenChange(false)
      } else if (event) {
        dispatch(event)
      }
    } finally {
      setBusy(false)
    }
  }

  const stepIndicator = declarationSheetStepIndicator(state)
  const stepCurrent = stepIndicator?.current ?? 0
  const stepTotal = stepIndicator?.total ?? 0
  const kicker = stepIndicator ? (
    <div className='text-muted-foreground px-4 pt-2 text-[11px] font-bold tracking-[0.08em] uppercase sm:px-0 sm:pt-0'>
      {t`Step ${stepCurrent} of ${stepTotal}`}
    </div>
  ) : null

  const canUndo = state.checkpoint?.checkpointId != null || state.sweep?.sweepBatchId != null
  const canRetryUndo = state.undo?.sweepFailed === true || state.undo?.checkpointFailed === true

  return (
    <ResponsiveOverlay open={open} onOpenChange={handleOpenChange}>
      <OverlayContent className='sm:max-w-md'>
        {state.phase === 'checkpoint' && (
          <>
            {kicker}
            <OverlayHeader>
              <OverlayTitle>{t`I understood up to here`}</OverlayTitle>
              <OverlayDescription>
                {t`Saves a checkpoint at your current reading position. Saved words that appeared in what you read and were due for review count as successful reviews — words you looked up along the way are never penalized.`}
              </OverlayDescription>
            </OverlayHeader>
            <div className='space-y-2 px-4 text-sm sm:px-0'>
              {checkpointPendingCount > 0 && (
                <p className='font-medium'>
                  {plural(checkpointPendingCount, {
                    one: '# review ready to collect.',
                    other: '# reviews ready to collect.',
                  })}
                </p>
              )}
              <p>
                <Link
                  to='/user-guide'
                  hash='checkpoint-reviews'
                  className='text-muted-foreground hover:text-foreground underline underline-offset-2'
                >
                  {t`Learn more in the user guide`}
                </Link>
              </p>
              {state.collectConflict && (
                <p className='text-amber-700 dark:text-amber-300'>{t`Your reading position changed — try again.`}</p>
              )}
              {collectFailed && <p className='text-destructive'>{t`Failed to save the checkpoint. Try again.`}</p>}
            </div>
            <OverlayFooter>
              <Button variant='outline' size='xl' disabled={busy} onClick={() => handleOpenChange(false)}>
                {t`Cancel`}
              </Button>
              {state.collectConflict ? (
                <Button size='xl' disabled={busy} onClick={handleConflictRetry}>
                  {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                  {t`Try again`}
                </Button>
              ) : (
                <Button size='xl' disabled={busy} onClick={() => void handleConfirm()}>
                  {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                  {busy ? t`Saving…` : t`Confirm`}
                </Button>
              )}
            </OverlayFooter>
          </>
        )}

        {state.phase === 'sweep' && (
          <>
            {kicker}
            <OverlayHeader>
              <OverlayTitle>
                {exactCount != null
                  ? plural(exactCount, { one: 'Mark # word as known?', other: 'Mark # words as known?' })
                  : t`Counting words…`}
              </OverlayTitle>
              <OverlayDescription>
                {state.checkpointIncluded
                  ? t`Everything you've read up to the checkpoint. You can un-mark any word later.`
                  : t`Everything you've read so far. You can un-mark any word later.`}
              </OverlayDescription>
            </OverlayHeader>
            <OverlayFooter>
              <Button variant='outline' size='xl' disabled={busy} onClick={() => dispatch({ type: 'skipSweep' })}>
                {t`Skip`}
              </Button>
              <Button size='xl' disabled={busy || exactCount == null} onClick={() => void handleSweep()}>
                {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                {busy ? t`Marking…` : t`Mark as known`}
              </Button>
            </OverlayFooter>
          </>
        )}

        {state.phase === 'done' && (
          <div className='flex flex-col items-center px-4 pt-4 pb-2 text-center sm:px-0 sm:pt-2'>
            <span className='bg-muted flex size-11 items-center justify-center rounded-full'>
              <CheckCircle2 className='size-5' />
            </span>
            <OverlayHeader className='px-0 pt-3 pb-0 sm:text-center'>
              <OverlayTitle>
                {state.checkpoint
                  ? t`Checkpoint saved`
                  : plural(state.sweep?.markedCount ?? 0, {
                      one: '# word marked as known',
                      other: '# words marked as known',
                    })}
              </OverlayTitle>
              <OverlayDescription className='sm:text-center'>
                {[
                  state.checkpoint && state.checkpoint.creditedCount > 0
                    ? plural(state.checkpoint.creditedCount, {
                        one: '# review collected',
                        other: '# reviews collected',
                      })
                    : null,
                  state.checkpoint && state.sweep
                    ? plural(state.sweep.markedCount, {
                        one: '# word marked as known',
                        other: '# words marked as known',
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </OverlayDescription>
            </OverlayHeader>
            {canUndo && (
              <Button variant='outline' className='mt-4' disabled={busy} onClick={() => void handleUndo()}>
                {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                {busy ? t`Undoing…` : t`Undo`}
              </Button>
            )}
            <p className='text-muted-foreground mt-3 pb-2 text-xs'>{t`Closes automatically`}</p>
          </div>
        )}

        {state.phase === 'undoError' && (
          <>
            <OverlayHeader>
              <OverlayTitle>{t`Undo didn't finish`}</OverlayTitle>
              <OverlayDescription />
            </OverlayHeader>
            <div className='space-y-2 px-4 text-sm sm:px-0'>
              {state.undo?.checkpointStale && <p>{t`The collected reviews were kept — a newer checkpoint exists.`}</p>}
              {state.undo?.checkpointFailed && <p>{t`The collected reviews weren't reverted.`}</p>}
              {state.undo?.sweepFailed && <p>{t`The known-word marks weren't removed.`}</p>}
            </div>
            <OverlayFooter>
              <Button variant='outline' size='xl' disabled={busy} onClick={() => handleOpenChange(false)}>
                {t`Close`}
              </Button>
              {canRetryUndo && (
                <Button size='xl' disabled={busy} onClick={() => void handleUndo()}>
                  {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                  {t`Try again`}
                </Button>
              )}
            </OverlayFooter>
          </>
        )}
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
