import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { Link } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  OverlayDescription,
  OverlayFooter,
} from '@/components/ui/responsive-overlay'
import { useCheckpointCandidates, useMarkKnownPreview } from '../api/sessions-hooks'
import {
  initialDeclarationSheetState,
  reduceDeclarationSheet,
  type DeclarationSheetEvent,
  type DeclarationSheetState,
} from '@flicktionary/core/utils/checkpoint-sweep-sheet-state'
import { CandidateChecklist, type CheckpointCandidate } from '@flicktionary/ui/components/candidate-checklist'

export type PreviewedSpan = { segmentIndex: number; selectionText: string }

// A checkpoint's "saved but never practiced" candidates.
export type ClaimsBatch = { checkpointId: string; candidates: CheckpointCandidate[] }

// One frontier per run: captured by session-view when the sheet opens, so the
// reviews list, the collect and the sweep all cover exactly the same range —
// the footer's debounced count can lag the live pointer.
export type DeclarationRun = {
  toSegmentIndex: number
  checkpointIncluded: boolean
  sweepIncluded: boolean
  // The preview-gloss selections at open: the reviews list and the collect
  // must suppress the same words.
  previewedSpans: PreviewedSpan[]
  // Leftover candidates from an earlier checkpoint — a run that re-enters on
  // the claims step instead of collecting.
  claims: ClaimsBatch | null
}

export type CollectOutcome =
  | { ok: true; checkpointId: string | null; creditedCount: number; backlogCandidates: CheckpointCandidate[] }
  | { ok: false; reason: 'conflict' | 'error' }

export type AssertOutcome = { ok: true; assertedCount: number } | { ok: false }

export type SweepOutcome = { ok: true; markedCount: number; sweepBatchId: string | null } | { ok: false }

// What a finished run wrote. A null part was skipped or not included.
export type DeclarationResult = {
  checkpoint: { checkpointId: string | null; creditedCount: number } | null
  claims: (ClaimsBatch & { assertedCount: number }) | null
  sweep: { markedCount: number; sweepBatchId: string | null } | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  // Kept non-null through the closing animation; only a new open replaces it.
  run: DeclarationRun | null
  // Async operations owned by session-view (they carry the claims
  // bookkeeping). All of them read the run snapshot through a ref, so a
  // conflict re-snapshot is visible without waiting for a re-render.
  onCollect: (excludedUserLookupIds: string[]) => Promise<CollectOutcome>
  // A collect CONFLICT means the pointer moved under us — re-snapshot the run
  // to the fresh pointer so the list reloads for the new span.
  onRefreshSnapshot: () => void
  onAssertClaims: (checkpointId: string, userLookupIds: string[]) => Promise<AssertOutcome>
  onSweep: () => Promise<SweepOutcome>
  // Fired once when the run ends with something written, just before the
  // sheet closes — the parent owns the confirmation toast and its combined
  // Undo.
  onFinished: (result: DeclarationResult) => void
}

const toggled = (ids: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

// The declaration flow (docs/READER-SPEC.md), one overlay (mobile drawer /
// desktop dialog) so the reading surface never moves: the reviews this
// checkpoint collects → the saved words never practiced → the mark-known
// sweep. Each step only appears when it has something to offer. Step state
// lives in the pure reducer in checkpoint-sweep-sheet-state.ts. The parent
// remounts this component (a fresh `key`) on every open, so all run state
// initializes here — a conflict re-snapshot only swaps the `run` prop and
// never restarts the machine.
export const CheckpointSweepSheet = ({
  open,
  onOpenChange,
  sessionId,
  run,
  onCollect,
  onRefreshSnapshot,
  onAssertClaims,
  onSweep,
  onFinished,
}: Props) => {
  const { t } = useLingui()
  const [state, setState] = useState(() =>
    initialDeclarationSheetState({
      checkpointIncluded: run?.checkpointIncluded ?? true,
      sweepIncluded: run?.sweepIncluded ?? true,
      claimsCount: run?.claims?.candidates.length ?? 0,
    })
  )
  // The claims step's batch: a re-entry run brings it, a collect returns it.
  const [claimsBatch, setClaimsBatch] = useState<ClaimsBatch | null>(run?.claims ?? null)
  const [deselectedReviews, setDeselectedReviews] = useState<ReadonlySet<string>>(new Set())
  const [deselectedClaims, setDeselectedClaims] = useState<ReadonlySet<string>>(new Set())
  // True while a mutation is in flight — dismissal is blocked so the overlay
  // can't vanish mid-write.
  const [busy, setBusy] = useState(false)
  const [collectProblem, setCollectProblem] = useState<'conflict' | 'error' | null>(null)

  const resultOf = (from: DeclarationSheetState, batch: ClaimsBatch | null): DeclarationResult => ({
    checkpoint: from.checkpoint,
    claims: from.claims && batch ? { ...batch, assertedCount: from.claims.assertedCount } : null,
    sweep: from.sweep,
  })
  // The reducer's `done` phase has no screen here: the run closes and the
  // parent confirms it in a toast.
  const dispatch = (event: DeclarationSheetEvent, batch: ClaimsBatch | null = claimsBatch) => {
    const next = reduceDeclarationSheet(state, event)
    if (next.phase === 'done') {
      onFinished(resultOf(next, batch))
      onOpenChange(false)
    } else {
      setState(next)
    }
  }

  const candidatesQuery = useCheckpointCandidates(
    sessionId,
    open && run?.checkpointIncluded && state.phase === 'checkpoint'
      ? { toSegmentIndex: run.toSegmentIndex, previewedSpans: run.previewedSpans }
      : null
  )
  const reviewCandidates = candidatesQuery.data ?? []
  const selectedReviewCount = reviewCandidates.filter((c) => !deselectedReviews.has(c.userLookupId)).length

  const claimCandidates = claimsBatch?.candidates ?? []
  const selectedClaims = claimCandidates.filter((c) => !deselectedClaims.has(c.userLookupId))

  // The authoritative count for THIS run's span — the footer pill shows a
  // debounced approximation; the sweep step must promise exactly what the
  // mutation will insert.
  const previewQuery = useMarkKnownPreview(sessionId, open && !!run?.sweepIncluded, run?.toSegmentIndex)
  const exactCount = previewQuery.data?.status === 'ready' ? previewQuery.data.markableLemmaCount : null

  // The sweep step evaporates when its exact count resolves to 0 (the pill's
  // debounced count over-promised): the run ends there, confirming whatever
  // the earlier steps wrote.
  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-pass-live-state-to-parent, react-you-might-not-need-an-effect/no-pass-data-to-parent -- the trigger is the span preview QUERY resolving to 0 (async server data), not a user event; there is no handler this could live in */
    if (!open || busy || state.phase !== 'sweep' || exactCount !== 0) return
    if (state.checkpoint || state.claims) {
      onFinished({
        checkpoint: state.checkpoint,
        claims: state.claims && claimsBatch ? { ...claimsBatch, assertedCount: state.claims.assertedCount } : null,
        sweep: null,
      })
    }
    onOpenChange(false)
    /* eslint-enable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-pass-live-state-to-parent, react-you-might-not-need-an-effect/no-pass-data-to-parent */
  }, [open, busy, state.phase, state.checkpoint, state.claims, claimsBatch, exactCount, onOpenChange, onFinished])

  // Dismissing after something was written means "skip the rest": the writes
  // stay, so the run still finishes with its confirmation.
  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return
    if (!next && (state.checkpoint || state.claims)) onFinished(resultOf(state, claimsBatch))
    onOpenChange(next)
  }

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    setCollectProblem(null)
    try {
      const excluded = reviewCandidates.filter((c) => deselectedReviews.has(c.userLookupId)).map((c) => c.userLookupId)
      const outcome = await onCollect(excluded)
      if (outcome.ok) {
        const batch =
          outcome.checkpointId && outcome.backlogCandidates.length > 0
            ? { checkpointId: outcome.checkpointId, candidates: outcome.backlogCandidates }
            : null
        setClaimsBatch(batch)
        dispatch(
          {
            type: 'collected',
            checkpointId: outcome.checkpointId,
            creditedCount: outcome.creditedCount,
            claimsCount: batch?.candidates.length ?? 0,
          },
          batch
        )
      } else {
        // On a conflict the span itself changed: reload the list for the new
        // frontier and let the reader confirm against what it shows now.
        if (outcome.reason === 'conflict') onRefreshSnapshot()
        setCollectProblem(outcome.reason)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleAssert = async () => {
    if (busy || !claimsBatch || selectedClaims.length === 0) return
    setBusy(true)
    try {
      const outcome = await onAssertClaims(
        claimsBatch.checkpointId,
        selectedClaims.map((c) => c.userLookupId)
      )
      // Failure already toasted by the mutation's meta — stay on the step so
      // the reader can retry or skip.
      if (outcome.ok) dispatch({ type: 'claimsAsserted', assertedCount: outcome.assertedCount })
    } finally {
      setBusy(false)
    }
  }

  const handleSweep = async () => {
    if (busy) return
    setBusy(true)
    try {
      const outcome = await onSweep()
      if (outcome.ok) dispatch({ type: 'swept', markedCount: outcome.markedCount, sweepBatchId: outcome.sweepBatchId })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={handleOpenChange}>
      {/* Desktop (Dialog): the centered dialog has no intrinsic height cap, so
          a long word list would overflow the viewport with no way to scroll —
          cap at 80vh and let the dialog itself scroll. The mobile Drawer
          already scrolls its own body. */}
      <OverlayContent className='sm:max-h-[80vh] sm:max-w-md sm:overflow-y-auto'>
        {state.phase === 'checkpoint' && (
          <>
            <OverlayHeader>
              <OverlayTitle>{t`I understood up to here`}</OverlayTitle>
              <OverlayDescription>
                {t`Saved words that were due for review and appeared in what you read. Confirming counts each checked word as a successful review — uncheck any you didn't understand and they simply stay due. Words you looked up along the way are left out.`}
              </OverlayDescription>
            </OverlayHeader>
            <div className='space-y-2 px-4 pb-2 text-sm sm:px-0'>
              {candidatesQuery.isPending ? (
                <div className='space-y-3 py-2'>
                  <Skeleton className='h-9 w-full' />
                  <Skeleton className='h-9 w-full' />
                  <Skeleton className='h-9 w-full' />
                </div>
              ) : candidatesQuery.isError ? (
                <p className='text-muted-foreground'>{t`Couldn't load the list of words. You can still save the checkpoint — every due word that appeared will count as reviewed.`}</p>
              ) : reviewCandidates.length === 0 ? (
                <p className='text-muted-foreground'>{t`No saved words were due for review in what you read. Saving the checkpoint still marks this part as read.`}</p>
              ) : (
                <CandidateChecklist
                  candidates={reviewCandidates}
                  deselectedIds={deselectedReviews}
                  onToggle={(id) => setDeselectedReviews((prev) => toggled(prev, id))}
                  disabled={busy}
                />
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
              {collectProblem === 'conflict' && (
                <p className='text-amber-700 dark:text-amber-300'>{t`Your reading position changed — check the list and confirm again.`}</p>
              )}
              {collectProblem === 'error' && (
                <p className='text-destructive'>{t`Failed to save the checkpoint. Try again.`}</p>
              )}
            </div>
            <OverlayFooter>
              <Button variant='outline' size='xl' disabled={busy} onClick={() => handleOpenChange(false)}>
                {t`Cancel`}
              </Button>
              <Button size='xl' disabled={busy || candidatesQuery.isPending} onClick={() => void handleConfirm()}>
                {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                {busy
                  ? t`Saving…`
                  : selectedReviewCount > 0
                    ? plural(selectedReviewCount, { one: 'Collect # review', other: 'Collect # reviews' })
                    : t`Save checkpoint`}
              </Button>
            </OverlayFooter>
          </>
        )}

        {state.phase === 'claims' && (
          <>
            <OverlayHeader>
              <OverlayTitle>
                {plural(claimCandidates.length, {
                  one: '# word you saved but never practiced',
                  other: '# words you saved but never practiced',
                })}
              </OverlayTitle>
              <OverlayDescription>
                {t`These saved words appeared in what you just read. Uncheck any that don't look right, then mark the rest as known to skip their learning ramp — each one gets a first check-in in about three weeks, and you can undo right after.`}
              </OverlayDescription>
            </OverlayHeader>
            <div className='px-4 pb-2 sm:px-0'>
              <CandidateChecklist
                candidates={claimCandidates}
                deselectedIds={deselectedClaims}
                onToggle={(id) => setDeselectedClaims((prev) => toggled(prev, id))}
                disabled={busy}
              />
            </div>
            <OverlayFooter>
              <Button variant='outline' size='xl' disabled={busy} onClick={() => dispatch({ type: 'skipClaims' })}>
                {t`Skip`}
              </Button>
              <Button size='xl' disabled={busy || selectedClaims.length === 0} onClick={() => void handleAssert()}>
                {busy ? <Loader2 className='size-4 animate-spin' /> : null}
                {busy
                  ? t`Marking…`
                  : plural(selectedClaims.length, { one: 'Mark # word as known', other: 'Mark # words as known' })}
              </Button>
            </OverlayFooter>
          </>
        )}

        {state.phase === 'sweep' && (
          <>
            <OverlayHeader>
              <OverlayTitle>
                {exactCount != null
                  ? plural(exactCount, {
                      one: 'Mark the # remaining word as known?',
                      other: 'Mark the # remaining words as known?',
                    })
                  : t`Counting words…`}
              </OverlayTitle>
              <OverlayDescription>
                {t`Every word in what you've read that isn't saved or marked yet. You can un-mark any word later.`}
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
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
