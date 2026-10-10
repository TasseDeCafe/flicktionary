import { useEffect, useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { Loader2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { CandidateChecklist, type CheckpointCandidate } from '@flicktionary/ui/components/candidate-checklist'
import {
  initialDeclarationSheetState,
  reduceDeclarationSheet,
  type DeclarationSheetEvent,
  type DeclarationSheetState,
} from '@flicktionary/core/utils/checkpoint-sweep-sheet-state'
import { declarationExactCount, type DeclarationResult, type DeclarationState } from './declaration-preview'

export type CollectOutcome =
  | { ok: true; checkpointId: string | null; creditedCount: number; backlogCandidates: CheckpointCandidate[] }
  | { ok: false; reason: 'conflict' | 'error' }

export type AssertOutcome = { ok: true; assertedCount: number } | { ok: false }

export type SweepOutcome = { ok: true; markedCount: number; sweepBatchId: string | null } | { ok: false }

export interface DeclarationSheetProps {
  declaration: DeclarationState
  onCollect: (excludedUserLookupIds: string[]) => Promise<CollectOutcome>
  // A collect CONFLICT means the pointer moved under us — re-snapshot the
  // frontier so the reviews list and the sweep count reload for the new span.
  onRefreshSnapshot: () => void
  onAssertClaims: (checkpointId: string, userLookupIds: string[]) => Promise<AssertOutcome>
  onSweep: () => Promise<SweepOutcome>
  // The run ended with something written: the controller closes the sheet and
  // owns the confirmation and its combined Undo.
  onFinished: (result: DeclarationResult) => void
  // Closed before anything was written.
  onClose: () => void
}

type ClaimsBatch = { checkpointId: string; candidates: CheckpointCandidate[] }

const toggled = (ids: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

// Title and buttons stay pinned; the description and the word list scroll
// between them, so the actions are reachable however short the player is.
// `overscroll-contain` keeps a wheel at the end of the list from scrolling
// the page under the video.
const Step = ({ title, children, footer }: { title: ReactNode; children: ReactNode; footer: ReactNode }) => (
  <>
    <p className='m-0 shrink-0 text-[15px] leading-tight font-semibold'>{title}</p>
    <div className='flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain'>{children}</div>
    <div className='flex shrink-0 justify-end gap-2'>{footer}</div>
  </>
)

const Description = ({ children }: { children: ReactNode }) => (
  <p className='m-0 text-xs leading-snug text-white/65'>{children}</p>
)

// The web reader's declaration flow (docs/READER-SPEC.md) as a centered panel
// over the video: the reviews this checkpoint collects → the saved words never
// practiced → the mark-known sweep. Step state lives in the shared pure
// reducer; async work arrives through the controller commands. The parent
// remounts this component per open (key = runKey), so all run state
// initializes here — a conflict re-snapshot only patches the declaration prop
// and never restarts the machine. Unlike the web, the first and last steps
// open included: the tap IS the checkpoint act, and the sweep learns its
// inclusion from the async preview (0/non-ready auto-skips it). There is no
// done screen — the run reports its result and the controller confirms it in
// a toast.
export const DeclarationSheet = ({
  declaration,
  onCollect,
  onRefreshSnapshot,
  onAssertClaims,
  onSweep,
  onFinished,
  onClose,
}: DeclarationSheetProps) => {
  const { t } = useLingui()
  const [state, setState] = useState(() =>
    initialDeclarationSheetState({ checkpointIncluded: true, sweepIncluded: true })
  )
  const [claimsBatch, setClaimsBatch] = useState<ClaimsBatch | null>(null)
  const [deselectedReviews, setDeselectedReviews] = useState<ReadonlySet<string>>(new Set())
  const [deselectedClaims, setDeselectedClaims] = useState<ReadonlySet<string>>(new Set())
  // True while a mutation is in flight — dismissal is blocked so the panel
  // can't vanish mid-write.
  const [busy, setBusy] = useState(false)
  // Failures are inline and retryable by pressing the button again: the
  // background handlers report them in the response instead of toasting.
  const [collectProblem, setCollectProblem] = useState<'conflict' | 'error' | null>(null)
  const [assertFailed, setAssertFailed] = useState(false)
  const [sweepFailed, setSweepFailed] = useState(false)

  const resultOf = (from: DeclarationSheetState, batch: ClaimsBatch | null): DeclarationResult => ({
    checkpoint: from.checkpoint,
    claims:
      from.claims && batch ? { checkpointId: batch.checkpointId, assertedCount: from.claims.assertedCount } : null,
    sweep: from.sweep,
  })
  const wrote = state.checkpoint != null || state.claims != null

  const dispatch = (event: DeclarationSheetEvent, batch: ClaimsBatch | null = claimsBatch) => {
    const next = reduceDeclarationSheet(state, event)
    if (next.phase === 'done') {
      onFinished(resultOf(next, batch))
    } else {
      setState(next)
    }
  }

  const previewLoading = declaration.preview.status === 'loading'
  const reviewCandidates = declaration.preview.status === 'ready' ? declaration.preview.reviewCandidates : null
  const selectedReviewCount = (reviewCandidates ?? []).filter((c) => !deselectedReviews.has(c.userLookupId)).length

  const claimCandidates = claimsBatch?.candidates ?? []
  const selectedClaims = claimCandidates.filter((c) => !deselectedClaims.has(c.userLookupId))

  const exactCount = declarationExactCount(declaration.preview)

  // The sweep step evaporates when its exact count resolves to 0 (nothing
  // markable, or a non-ready/failed profile): the run ends there, confirming
  // whatever the earlier steps wrote.
  useEffect(() => {
    if (busy || state.phase !== 'sweep' || exactCount !== 0) return
    if (state.checkpoint || state.claims) {
      onFinished({
        checkpoint: state.checkpoint,
        claims:
          state.claims && claimsBatch
            ? { checkpointId: claimsBatch.checkpointId, assertedCount: state.claims.assertedCount }
            : null,
        sweep: null,
      })
    } else {
      onClose()
    }
  }, [busy, state.phase, state.checkpoint, state.claims, claimsBatch, exactCount, onFinished, onClose])

  // Before the first write this is a plain cancel; after one it means "skip
  // the rest" — the writes stay, so the run still finishes with its
  // confirmation.
  const handleDismiss = () => {
    if (busy) return
    if (wrote) onFinished(resultOf(state, claimsBatch))
    else onClose()
  }

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    setCollectProblem(null)
    try {
      const excluded = (reviewCandidates ?? [])
        .filter((c) => deselectedReviews.has(c.userLookupId))
        .map((c) => c.userLookupId)
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
        // frontier and let the viewer confirm against what it shows now.
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
    setAssertFailed(false)
    try {
      const outcome = await onAssertClaims(
        claimsBatch.checkpointId,
        selectedClaims.map((c) => c.userLookupId)
      )
      if (outcome.ok) {
        dispatch({ type: 'claimsAsserted', assertedCount: outcome.assertedCount })
      } else {
        setAssertFailed(true)
      }
    } finally {
      setBusy(false)
    }
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

  const spinner = busy ? <Loader2 className='size-4 animate-spin' /> : null

  return (
    // Scrim over the whole video box: opts back into pointer events (the host
    // is click-through) and dismisses on a direct press when idle.
    <div
      className='pointer-events-auto absolute inset-0 z-10 grid grid-rows-[minmax(0,1fr)] place-items-center bg-black/30'
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) handleDismiss()
      }}
    >
      {/* Capped to the player, not the viewport: the panel lives inside the
          video box, which can be far shorter than the page. */}
      <div className='dark font-sans flex max-h-[calc(100%-24px)] w-[400px] max-w-[calc(100%-24px)] flex-col gap-3 rounded-xl bg-[rgba(20,20,20,0.96)] p-4 text-white shadow-[0_8px_28px_rgba(0,0,0,0.5)]'>
        {state.phase === 'checkpoint' && (
          <Step
            title={t`I understood up to here`}
            footer={
              <>
                <Button variant='outline' disabled={busy} onClick={handleDismiss}>
                  {t`Cancel`}
                </Button>
                <Button disabled={busy || previewLoading} onClick={() => void handleConfirm()}>
                  {spinner}
                  {busy
                    ? t`Saving…`
                    : selectedReviewCount > 0
                      ? plural(selectedReviewCount, { one: 'Collect # review', other: 'Collect # reviews' })
                      : t`Save checkpoint`}
                </Button>
              </>
            }
          >
            <Description>
              {t`Saved words that were due for review and appeared in the subtitles so far. Confirming counts each checked word as a successful review — uncheck any you didn't understand and they simply stay due. Words you looked up along the way are left out.`}
            </Description>
            {previewLoading ? (
              <div className='flex flex-col gap-3 py-2'>
                <Skeleton className='h-9 w-full' />
                <Skeleton className='h-9 w-full' />
                <Skeleton className='h-9 w-full' />
              </div>
            ) : reviewCandidates == null ? (
              <p className='m-0 text-sm text-white/65'>
                {t`Couldn't load the list of words. You can still save the checkpoint — every due word that appeared will count as reviewed.`}
              </p>
            ) : reviewCandidates.length === 0 ? (
              <p className='m-0 text-sm text-white/65'>
                {t`No saved words were due for review in what you watched. Saving the checkpoint still marks this part as watched.`}
              </p>
            ) : (
              <CandidateChecklist
                candidates={reviewCandidates}
                deselectedIds={deselectedReviews}
                onToggle={(id) => setDeselectedReviews((prev) => toggled(prev, id))}
                disabled={busy}
              />
            )}
            {collectProblem === 'conflict' && (
              <p className='m-0 text-sm text-amber-300'>{t`Your reading position changed — check the list and confirm again.`}</p>
            )}
            {collectProblem === 'error' && (
              <p className='m-0 text-sm text-red-300'>{t`Failed to save the checkpoint. Try again.`}</p>
            )}
          </Step>
        )}

        {state.phase === 'claims' && (
          <Step
            title={plural(claimCandidates.length, {
              one: '# word you saved but never practiced',
              other: '# words you saved but never practiced',
            })}
            footer={
              <>
                <Button variant='outline' disabled={busy} onClick={() => dispatch({ type: 'skipClaims' })}>
                  {t`Skip`}
                </Button>
                <Button disabled={busy || selectedClaims.length === 0} onClick={() => void handleAssert()}>
                  {spinner}
                  {busy
                    ? t`Marking…`
                    : plural(selectedClaims.length, { one: 'Mark # word as known', other: 'Mark # words as known' })}
                </Button>
              </>
            }
          >
            <Description>
              {t`These saved words appeared in what you just watched. Uncheck any that don't look right, then mark the rest as known to skip their learning ramp — each one gets a first check-in in about three weeks, and you can undo right after.`}
            </Description>
            <CandidateChecklist
              candidates={claimCandidates}
              deselectedIds={deselectedClaims}
              onToggle={(id) => setDeselectedClaims((prev) => toggled(prev, id))}
              disabled={busy}
            />
            {assertFailed && <p className='m-0 text-sm text-red-300'>{t`Failed to mark words. Try again.`}</p>}
          </Step>
        )}

        {state.phase === 'sweep' && (
          <Step
            title={
              exactCount != null
                ? plural(exactCount, {
                    one: 'Mark the # remaining word as known?',
                    other: 'Mark the # remaining words as known?',
                  })
                : t`Counting words…`
            }
            footer={
              <>
                <Button variant='outline' disabled={busy} onClick={() => dispatch({ type: 'skipSweep' })}>
                  {t`Skip`}
                </Button>
                <Button disabled={busy || exactCount == null} onClick={() => void handleSweep()}>
                  {spinner}
                  {busy ? t`Marking…` : t`Mark as known`}
                </Button>
              </>
            }
          >
            <Description>
              {t`Every word in what you've watched that isn't saved or marked yet. You can un-mark any word later.`}
            </Description>
            {sweepFailed && <p className='m-0 text-sm text-red-300'>{t`Failed to mark words. Try again.`}</p>}
          </Step>
        )}
      </div>
    </div>
  )
}
