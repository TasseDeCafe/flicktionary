import { toast } from 'sonner'
import { msg, plural } from '@lingui/core/macro'
import { i18n } from '../lingui'
import { dispatchToast } from './toaster-host'
import type { DeclarationResult } from './declaration-preview'
import { runDeclarationUndo, type DeclarationUndoOps } from './declaration-undo'

const TOAST_DURATION_MS = 8000

// `Checkpoint saved` with the collected / asserted / marked counts as its
// description, or the first count as the title when no checkpoint was saved.
// Null when the run wrote nothing worth confirming (an empty-span collect).
const declarationToastCopy = (result: DeclarationResult): { title: string; description?: string } | null => {
  const creditedCount = result.checkpoint?.creditedCount ?? 0
  const assertedCount = result.claims?.assertedCount ?? 0
  const parts = [
    creditedCount > 0 ? plural(creditedCount, { one: '# review collected', other: '# reviews collected' }) : null,
    assertedCount > 0
      ? plural(assertedCount, { one: '# saved word marked as known', other: '# saved words marked as known' })
      : null,
    result.sweep
      ? plural(result.sweep.markedCount, { one: '# word marked as known', other: '# words marked as known' })
      : null,
  ].filter((part) => part != null)
  const title = result.checkpoint?.checkpointId ? i18n._(msg`Checkpoint saved`) : parts.shift()
  if (!title) {
    return null
  }
  return { title, description: parts.length > 0 ? parts.join(' · ') : undefined }
}

const hasUndoableParts = (result: DeclarationResult): boolean =>
  result.checkpoint?.checkpointId != null ||
  result.sweep?.sweepBatchId != null ||
  (result.claims?.assertedCount ?? 0) > 0

// One toast confirms a finished declaration run, like the web reader's
// (docs/READER-SPEC.md, "Declaration toast"), through the page-global sonner
// toaster. After a partial undo failure the confirmation comes back carrying
// only what is still un-reverted, so Undo stays retryable. Returns false when
// there was nothing to confirm.
export const showDeclarationToast = (
  result: DeclarationResult,
  ops: DeclarationUndoOps,
  // Runs after every undo attempt — the reverted parts change the counts the
  // overlay shows.
  onUndoSettled: () => void
): boolean => {
  const copy = declarationToastCopy(result)
  if (!copy) {
    return false
  }

  const undo = async () => {
    const { remaining, checkpointStale } = await runDeclarationUndo(result, ops)
    onUndoSettled()
    if (checkpointStale) {
      dispatchToast(() => toast.info(i18n._(msg`The collected reviews were kept — a newer checkpoint exists.`)))
    }
    if (remaining) {
      dispatchToast(() => toast.error(i18n._(msg`Undo didn't finish. Try again.`)))
      showDeclarationToast(remaining, ops, onUndoSettled)
    } else if (!checkpointStale) {
      dispatchToast(() => toast(i18n._(msg`Undone`)))
    }
  }

  dispatchToast(() =>
    toast.success(copy.title, {
      description: copy.description,
      duration: TOAST_DURATION_MS,
      action: hasUndoableParts(result) ? { label: i18n._(msg`Undo`), onClick: () => void undo() } : undefined,
    })
  )
  return true
}
