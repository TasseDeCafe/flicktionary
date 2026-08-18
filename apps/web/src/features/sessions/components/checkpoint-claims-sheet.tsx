import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { toast } from 'sonner'
import { CheckIcon } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  OverlayDescription,
  OverlayFooter,
} from '@/components/ui/responsive-overlay'
import { useAssertKnownBacklog, useUndoKnownAssertions } from '../api/sessions-hooks'

export type CheckpointBacklogCandidate = {
  userLookupId: string
  headword: string
  sense: string
  // Evidence: the surface form seen in the text (for MWEs, the anchor content
  // word; null for checkpoints stored before evidence existed) and its
  // context window.
  matchedSurface: string | null
  context: string | null
}

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  sessionId: string
  checkpointId: string | null
  candidates: CheckpointBacklogCandidate[]
  // Fired after a successful assert so the parent can drop its re-entry
  // affordance (asserting the same batch twice would just skip everything).
  onAsserted?: () => void
  // Fired after the assertion toast's Undo actually reverted something, with
  // the batch to restore — undo means "let me reconsider", so the re-entry
  // must come back (the checkpoint is still live and accepts a re-assert).
  onAssertUndone?: (restore: { checkpointId: string; candidates: CheckpointBacklogCandidate[] }) => void
}

// How many candidates show before the rest collapse behind a disclosure.
const VISIBLE_CANDIDATES = 8

// The matched word emphasized inside its context window. Matching can be
// homograph-fuzzy, so the sentence is the user's chance to catch a false
// positive before asserting — when the surface isn't found (or is null, e.g.
// pre-evidence checkpoints) the plain context still renders.
const EvidenceLine = ({ surface, context }: { surface: string | null; context: string | null }) => {
  if (!context) return null
  const at = surface ? context.toLowerCase().indexOf(surface.toLowerCase()) : -1
  return (
    <span className='text-muted-foreground mt-0.5 block text-xs'>
      {at === -1 || !surface ? (
        context
      ) : (
        <>
          {context.slice(0, at)}
          <span className='text-foreground font-semibold'>{context.slice(at, at + surface.length)}</span>
          {context.slice(at + surface.length)}
        </>
      )}
    </span>
  )
}

// Presentational checkbox indicator — deliberately NOT the Radix Checkbox,
// which renders its own <button> and would nest inside the row button
// (invalid HTML). The row is the single interactive element.
const SelectionIndicator = ({ checked }: { checked: boolean }) => (
  <span
    aria-hidden
    className={cn(
      'border-input mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs',
      checked && 'bg-primary text-primary-foreground border-primary'
    )}
  >
    {checked && <CheckIcon className='size-3.5' />}
  </span>
)

// The opt-in claims sheet behind a checkpoint (docs/SRS.md §6c): "these saved
// words appeared in what you just read but were never practiced — mark them
// known?" Every row shows WHERE the word was seen and can be deselected; one
// confirm CTA asserts the selected subset. The seed puts their first
// verification ~3 weeks out, and the success toast carries its own undo.
export const CheckpointClaimsSheet = ({
  open,
  onOpenChange,
  sessionId,
  checkpointId,
  candidates,
  onAsserted,
  onAssertUndone,
}: Props) => {
  const { t } = useLingui()
  const [expanded, setExpanded] = useState(false)
  // Deselections are keyed to the checkpoint they were made against, so a new
  // checkpoint's batch starts fully selected without an effect to reset it.
  const [deselection, setDeselection] = useState<{ checkpointId: string | null; ids: ReadonlySet<string> }>({
    checkpointId: null,
    ids: new Set(),
  })
  const { mutate: assertKnown, isPending } = useAssertKnownBacklog(sessionId)
  const { mutate: undoAssertions } = useUndoKnownAssertions(sessionId)

  const unselectedIds = deselection.checkpointId === checkpointId ? deselection.ids : new Set<string>()
  const selected = candidates.filter((c) => !unselectedIds.has(c.userLookupId))
  const count = candidates.length
  const selectedCount = selected.length
  const visible = expanded ? candidates : candidates.slice(0, VISIBLE_CANDIDATES)
  const hiddenCount = count - visible.length

  const toggle = (userLookupId: string) => {
    const next = new Set(unselectedIds)
    if (next.has(userLookupId)) next.delete(userLookupId)
    else next.add(userLookupId)
    setDeselection({ checkpointId, ids: next })
  }

  const handleConfirm = () => {
    if (!checkpointId || selectedCount === 0) return
    assertKnown(
      { sessionId, checkpointId, userLookupIds: selected.map((c) => c.userLookupId) },
      {
        onSuccess: (response) => {
          onOpenChange(false)
          onAsserted?.()
          const assertedCount = response.data.asserted
          toast.success(plural(assertedCount, { one: '# word marked as known', other: '# words marked as known' }), {
            action: {
              label: t`Undo`,
              // Restore the batch only when the undo reverted something — a
              // fully-skipped undo (every facet superseded by a later rating)
              // would restore a batch whose re-assert can only skip.
              onClick: () =>
                undoAssertions(
                  { sessionId, checkpointId },
                  {
                    onSuccess: ({ data }) => {
                      if (data.reverted > 0) onAssertUndone?.({ checkpointId, candidates })
                    },
                  }
                ),
            },
          })
        },
      }
    )
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      {/* Desktop (Dialog): the centered dialog has no intrinsic height cap, so
          an expanded candidate list would overflow the viewport with no way to
          scroll — cap at 80vh and let the dialog itself scroll. The mobile
          Drawer already scrolls its own body. */}
      <OverlayContent className='sm:max-h-[80vh] sm:overflow-y-auto'>
        <OverlayHeader>
          <OverlayTitle>
            {plural(count, {
              one: '# word you saved but never practiced',
              other: '# words you saved but never practiced',
            })}
          </OverlayTitle>
          <OverlayDescription>
            {t`These saved words appeared in what you just read. Uncheck any that don't look right, then mark the rest as known to skip their learning ramp — each one gets a first check-in in about three weeks, and you can undo right after.`}
          </OverlayDescription>
        </OverlayHeader>

        <div className='px-4 pb-2 sm:px-0'>
          <ul className='text-sm'>
            {visible.map((candidate) => {
              const checked = !unselectedIds.has(candidate.userLookupId)
              return (
                <li key={candidate.userLookupId} className='border-b last:border-b-0'>
                  <button
                    type='button'
                    aria-pressed={checked}
                    onClick={() => toggle(candidate.userLookupId)}
                    className={cn(
                      'flex w-full items-start gap-2 py-2 text-left transition-colors hover:bg-gray-50 active:bg-gray-100',
                      !checked && 'opacity-60'
                    )}
                  >
                    <SelectionIndicator checked={checked} />
                    <span className='min-w-0'>
                      <span className='font-medium'>{candidate.headword}</span>
                      {candidate.sense && <span className='text-muted-foreground ml-2'>{candidate.sense}</span>}
                      <EvidenceLine surface={candidate.matchedSurface} context={candidate.context} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {hiddenCount > 0 && (
            <button
              type='button'
              className='text-muted-foreground hover:text-foreground mt-2 text-sm underline underline-offset-2'
              onClick={() => setExpanded(true)}
            >
              {t`Show all ${count} words`}
            </button>
          )}
        </div>

        <OverlayFooter>
          <Button variant='outline' size='xl' onClick={() => onOpenChange(false)} disabled={isPending}>
            {t`Not now`}
          </Button>
          <Button size='xl' onClick={handleConfirm} disabled={isPending || !checkpointId || selectedCount === 0}>
            {isPending
              ? t`Marking…`
              : plural(selectedCount, { one: 'Mark # word as known', other: 'Mark # words as known' })}
          </Button>
        </OverlayFooter>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
