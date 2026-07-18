import { BookmarkCheck, Loader2 } from 'lucide-react'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { useProcessStudySession } from '../api/sessions-hooks'

type Props = {
  sessionId: string
  highlightCount: number
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
}

export const SessionVocabularyFooter = ({
  sessionId,
  highlightCount,
  isGeneratingCandidates = false,
  onOpenSessionVocabulary,
  checkpointPendingCount = 0,
  checkpointBacklogCount = 0,
  onCollectCheckpoint,
  isCollectingCheckpoint = false,
}: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useProcessStudySession(sessionId)

  // Highlights are enriched in the background as they're selected, so opening
  // Session vocabulary is just a navigation. The click only enqueues background
  // discovery (the backend process route is a near no-op kept for old clients).
  const hint = highlightCount === 0 ? t`No highlights yet.` : t`${highlightCount} highlight(s) saved.`

  const label = isPending ? t`Opening…` : t`Session vocabulary`

  const handleClick = () => {
    mutate({ sessionId }, { onSuccess: () => onOpenSessionVocabulary?.() })
  }

  // The label is the comprehension assertion, not the reward — the pending
  // count rides along as a passive badge and "N reviews collected" is the
  // result toast, so the button never invites pressing without the assertion
  // being true.
  const showCheckpoint = !!onCollectCheckpoint && checkpointPendingCount + checkpointBacklogCount > 0

  return (
    <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t p-3 backdrop-blur'>
      <div className='mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3'>
        <span className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
          {hint}
          {isGeneratingCandidates && (
            <span className='flex items-center gap-1.5 text-amber-700 dark:text-amber-300'>
              <Loader2 className='size-3.5 animate-spin' />
              {t`Finding suggestions…`}
            </span>
          )}
        </span>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          {showCheckpoint && (
            <Button
              size='xl'
              variant='secondary'
              disabled={isCollectingCheckpoint}
              onClick={onCollectCheckpoint}
              className='w-full sm:w-auto'
            >
              {isCollectingCheckpoint ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <BookmarkCheck className='size-4' />
              )}
              {t`I've followed up to here`}
              {checkpointPendingCount > 0 && (
                <span className='bg-foreground/10 ml-1 rounded-full px-2 py-0.5 text-xs tabular-nums'>
                  {checkpointPendingCount}
                </span>
              )}
            </Button>
          )}
          <Button size='xl' disabled={isPending} onClick={handleClick} className='w-full sm:w-auto'>
            {label}
          </Button>
        </div>
      </div>
    </div>
  )
}
