import { Loader2 } from 'lucide-react'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { useProcessStudySession } from '../api/sessions-hooks'

type Props = {
  sessionId: string
  status: string
  highlightCount: number
  unprocessedHighlightCount: number
  cardCount: number
  // True while suggestion spans are being generated for the reader's window.
  // Shown as a subtle loader so the multi-second wait doesn't look broken.
  isGeneratingCandidates?: boolean
  onOpenTriage?: () => void
}

export const TriageFooter = ({
  sessionId,
  status,
  highlightCount,
  unprocessedHighlightCount,
  cardCount,
  isGeneratingCandidates = false,
  onOpenTriage,
}: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useProcessStudySession(sessionId)

  // Highlights are enriched in the background as they're selected, so opening
  // triage is just a navigation. The click only enqueues background discovery
  // (the backend process route is a near no-op kept for old clients).
  const isReprocess = status === 'processed' || status === 'exported'
  const isFailed = status === 'failed'
  const noPriorOutput = cardCount === 0
  const isReprocessNothingNew = isReprocess && !noPriorOutput && unprocessedHighlightCount === 0
  const showFooter = status === 'active' || isReprocess || isFailed

  if (!showFooter) {
    return null
  }

  const hint = (() => {
    if (isFailed) return t`Previous processing failed. You can still open triage.`
    if (isReprocess && noPriorOutput) return t`No cards have been generated yet.`
    if (isReprocessNothingNew) return t`All highlights have been processed.`
    if (isReprocess) return t`${unprocessedHighlightCount} new highlight(s) still enriching.`
    if (highlightCount === 0) return t`No highlights yet.`
    return t`${highlightCount} highlight(s) saved.`
  })()

  const label = (() => {
    if (isPending) return t`Opening…`
    return t`Go to triage`
  })()

  const handleClick = () => {
    if (isReprocessNothingNew) {
      onOpenTriage?.()
      return
    }
    mutate({ sessionId }, { onSuccess: () => onOpenTriage?.() })
  }

  return (
    <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 p-3 backdrop-blur'>
      <div className='mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3'>
        <span className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
          {hint}
          {isGeneratingCandidates && (
            <span className='flex items-center gap-1.5 text-amber-700'>
              <Loader2 className='size-3.5 animate-spin' />
              {t`Finding suggestions…`}
            </span>
          )}
        </span>
        <Button size='xl' disabled={isPending} onClick={handleClick} className='w-full sm:w-auto'>
          {label}
        </Button>
      </div>
    </div>
  )
}
