import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import {
  declarationSheetStepIndicator,
  initialDeclarationSheetState,
  reduceDeclarationSheet,
  reduceUndoOutcome,
  type DeclarationSheetEvent,
} from '@flicktionary/core/utils/checkpoint-sweep-sheet-state'
import { declarationExactCount, type DeclarationState } from './declaration-preview'

export type CollectOutcome =
  { ok: true; checkpointId: string | null; creditedCount: number } | { ok: false; reason: 'conflict' | 'error' }

export type SweepOutcome = { ok: true; markedCount: number; sweepBatchId: string | null } | { ok: false }

export interface DeclarationSheetProps {
  declaration: DeclarationState
  onCollect: () => Promise<CollectOutcome>
  // A collect CONFLICT means the pointer moved under us — re-snapshot the
  // frontier (and its previews) before retrying.
  onRefreshSnapshot: () => void
  onSweep: () => Promise<SweepOutcome>
  onUndoSweep: (sweepBatchId: string) => Promise<boolean>
  onUndoCheckpoint: (checkpointId: string) => Promise<{ ok: boolean; undone: boolean }>
  onClose: () => void
}

const DONE_AUTO_CLOSE_MS = 4000

// The web reader's merged declaration flow (checkpoint → optional mark-known
// sweep → done) re-skinned as a centered panel over the video. Step state
// lives in the shared pure reducer; async work arrives through the controller
// commands. The parent remounts this component per open (key = runKey), so
// all run state initializes here — a conflict re-snapshot only patches the
// declaration prop and never restarts the machine. Unlike the web, both steps
// open included: the tap IS the checkpoint act, and the sweep learns its
// inclusion from the async preview (0/non-ready auto-skips it).
export const DeclarationSheet = ({
  declaration,
  onCollect,
  onRefreshSnapshot,
  onSweep,
  onUndoSweep,
  onUndoCheckpoint,
  onClose,
}: DeclarationSheetProps) => {
  const { t } = useLingui()
  const [state, setState] = useState(() =>
    initialDeclarationSheetState({ checkpointIncluded: true, sweepIncluded: true })
  )
  const dispatch = (event: DeclarationSheetEvent) => setState((prev) => reduceDeclarationSheet(prev, event))
  // True while a mutation is in flight — dismissal is blocked so the panel
  // can't vanish mid-write.
  const [busy, setBusy] = useState(false)
  // Non-conflict failures: inline, retryable by pressing the button again. The
  // web absorbs these silently (its mutation meta toasts); the overlay has no
  // toast layer, so each step carries its own failure line.
  const [collectFailed, setCollectFailed] = useState(false)
  const [sweepFailed, setSweepFailed] = useState(false)

  const exactCount = declarationExactCount(declaration.preview)
  const pendingCount = declaration.preview.status === 'ready' ? declaration.preview.pendingCount : null

  // The sweep step evaporates when its exact count resolves to 0 (nothing
  // markable, or a non-ready/failed profile): the run jumps to done, or closes
  // if nothing was collected either.
  useEffect(() => {
    if (busy || state.phase !== 'sweep' || exactCount !== 0) return
    if (state.checkpoint) {
      dispatch({ type: 'skipSweep' })
    } else {
      onClose()
    }
  }, [busy, state.phase, state.checkpoint, exactCount, onClose])

  // Auto-close the done screen — cancelled while an undo is running.
  useEffect(() => {
    if (busy || state.phase !== 'done') return
    const timer = setTimeout(onClose, DONE_AUTO_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [busy, state.phase, onClose])

  const handleDismiss = () => {
    if (busy) return
    onClose()
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
    setSweepFailed(false)
    try {
      const outcome = await onSweep()
      if (outcome.ok) {
        dispatch({ type: 'swept', markedCount: outcome.markedCount, sweepBatchId: outcome.sweepBatchId })
      } else {
        setSweepFailed(true)
      }
    } finally {
      setBusy(false)
    }
  }

  // The combined Undo: two independent endpoints, attempted sequentially and
  // both reported — a partial failure keeps the panel open and says what was
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
        onClose()
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
    <div className='text-[11px] font-bold tracking-[0.08em] text-white/60 uppercase'>
      {t`Step ${stepCurrent} of ${stepTotal}`}
    </div>
  ) : null

  const canUndo = state.checkpoint?.checkpointId != null || state.sweep?.sweepBatchId != null
  const canRetryUndo = state.undo?.sweepFailed === true || state.undo?.checkpointFailed === true
  // An empty span collects as a success with a null checkpoint id — the done
  // screen must not claim a checkpoint was saved.
  const realCheckpoint = state.checkpoint?.checkpointId != null

  return (
    // Scrim over the whole video box: opts back into pointer events (the host
    // is click-through) and dismisses on a direct press when idle.
    <div
      className='pointer-events-auto absolute inset-0 z-10 grid place-items-center bg-black/30'
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) handleDismiss()
      }}
    >
      <div className='dark font-sans flex w-[360px] max-w-[calc(100%-24px)] flex-col gap-3 rounded-xl bg-[rgba(20,20,20,0.96)] p-4 text-white shadow-[0_8px_28px_rgba(0,0,0,0.5)]'>
        {state.phase === 'checkpoint' && (
          <>
            {kicker}
            <div className='flex flex-col gap-1'>
              <p className='m-0 text-[15px] leading-tight font-semibold'>{t`I understood up to here`}</p>
              <p className='m-0 text-xs leading-snug text-white/65'>
                {t`Saves a checkpoint at your current position. Saved words that appeared in the subtitles so far and were due for review count as successful reviews — words you looked up along the way are never penalized.`}
              </p>
            </div>
            {pendingCount != null && pendingCount > 0 && (
              <p className='m-0 text-sm font-medium'>
                {plural(pendingCount, { one: '# review ready to collect.', other: '# reviews ready to collect.' })}
              </p>
            )}
            {state.collectConflict && (
              <p className='m-0 text-sm text-amber-300'>{t`Your reading position changed — try again.`}</p>
            )}
            {collectFailed && (
              <p className='m-0 text-sm text-red-300'>{t`Failed to save the checkpoint. Try again.`}</p>
            )}
            <div className='flex justify-end gap-2'>
              <Button variant='outline' disabled={busy} onClick={handleDismiss}>
                {t`Cancel`}
              </Button>
              {state.collectConflict ? (
                <Button disabled={busy} onClick={handleConflictRetry}>
                  {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                  {t`Try again`}
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => void handleConfirm()}>
                  {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                  {busy ? t`Saving…` : t`Confirm`}
                </Button>
              )}
            </div>
          </>
        )}

        {state.phase === 'sweep' && (
          <>
            {kicker}
            <div className='flex flex-col gap-1'>
              <p className='m-0 text-[15px] leading-tight font-semibold'>
                {exactCount != null
                  ? plural(exactCount, { one: 'Mark # word as known?', other: 'Mark # words as known?' })
                  : t`Counting words…`}
              </p>
              <p className='m-0 text-xs leading-snug text-white/65'>
                {t`Everything you've watched up to the checkpoint. You can un-mark any word later.`}
              </p>
            </div>
            {sweepFailed && <p className='m-0 text-sm text-red-300'>{t`Failed to mark words. Try again.`}</p>}
            <div className='flex justify-end gap-2'>
              <Button variant='outline' disabled={busy} onClick={() => dispatch({ type: 'skipSweep' })}>
                {t`Skip`}
              </Button>
              <Button disabled={busy || exactCount == null} onClick={() => void handleSweep()}>
                {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                {busy ? t`Marking…` : t`Mark as known`}
              </Button>
            </div>
          </>
        )}

        {state.phase === 'done' && (
          <div className='flex flex-col items-center gap-3 py-2 text-center'>
            <span className='flex size-11 items-center justify-center rounded-full bg-white/10'>
              <CheckCircle2 className='size-5' />
            </span>
            <div className='flex flex-col gap-1'>
              <p className='m-0 text-[15px] leading-tight font-semibold'>
                {realCheckpoint
                  ? t`Checkpoint saved`
                  : state.sweep
                    ? plural(state.sweep.markedCount, {
                        one: '# word marked as known',
                        other: '# words marked as known',
                      })
                    : t`You're all caught up — nothing new to collect.`}
              </p>
              {(realCheckpoint || state.sweep) && (
                <p className='m-0 text-xs leading-snug text-white/65'>
                  {[
                    realCheckpoint && (state.checkpoint?.creditedCount ?? 0) > 0
                      ? plural(state.checkpoint?.creditedCount ?? 0, {
                          one: '# review collected',
                          other: '# reviews collected',
                        })
                      : null,
                    realCheckpoint && state.sweep
                      ? plural(state.sweep.markedCount, {
                          one: '# word marked as known',
                          other: '# words marked as known',
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
            {canUndo && (
              <Button variant='outline' disabled={busy} onClick={() => void handleUndo()}>
                {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                {busy ? t`Undoing…` : t`Undo`}
              </Button>
            )}
            <p className='m-0 text-xs text-white/50'>{t`Closes automatically`}</p>
          </div>
        )}

        {state.phase === 'undoError' && (
          <>
            <p className='m-0 text-[15px] leading-tight font-semibold'>{t`Undo didn't finish`}</p>
            <div className='flex flex-col gap-1 text-sm'>
              {state.undo?.checkpointStale && (
                <p className='m-0'>{t`The collected reviews were kept — a newer checkpoint exists.`}</p>
              )}
              {state.undo?.checkpointFailed && <p className='m-0'>{t`The collected reviews weren't reverted.`}</p>}
              {state.undo?.sweepFailed && <p className='m-0'>{t`The known-word marks weren't removed.`}</p>}
            </div>
            <div className='flex justify-end gap-2'>
              <Button variant='outline' disabled={busy} onClick={handleDismiss}>
                {t`Close`}
              </Button>
              {canRetryUndo && (
                <Button disabled={busy} onClick={() => void handleUndo()}>
                  {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                  {t`Try again`}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
