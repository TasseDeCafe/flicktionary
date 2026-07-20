import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { toast } from 'sonner'
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

// The opt-in claims sheet behind a checkpoint (docs/SRS.md §6c): "these saved
// words appeared in what you just read but were never practiced — mark them
// known?" One confirm CTA for the whole group; the seed puts their first
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
  const { mutate: assertKnown, isPending } = useAssertKnownBacklog(sessionId)
  const { mutate: undoAssertions } = useUndoKnownAssertions(sessionId)

  const count = candidates.length
  const visible = expanded ? candidates : candidates.slice(0, VISIBLE_CANDIDATES)
  const hiddenCount = count - visible.length

  const handleConfirm = () => {
    if (!checkpointId || count === 0) return
    assertKnown(
      { sessionId, checkpointId, userLookupIds: candidates.map((c) => c.userLookupId) },
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
            {t`These saved words appeared in what you just read. Mark them as known to skip their learning ramp — each one gets a first check-in in about three weeks, and you can undo right after.`}
          </OverlayDescription>
        </OverlayHeader>

        <div className='px-4 pb-2 sm:px-0'>
          <ul className='text-sm'>
            {visible.map((candidate) => (
              <li key={candidate.userLookupId} className='flex items-baseline gap-2 border-b py-2 last:border-b-0'>
                <span className='font-medium'>{candidate.headword}</span>
                {candidate.sense && <span className='text-muted-foreground truncate'>{candidate.sense}</span>}
              </li>
            ))}
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
          <Button size='xl' onClick={handleConfirm} disabled={isPending || !checkpointId || count === 0}>
            {isPending ? t`Marking…` : plural(count, { one: 'Mark # word as known', other: 'Mark # words as known' })}
          </Button>
        </OverlayFooter>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
