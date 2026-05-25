import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { useProcessStudySession } from '../api/sessions-hooks'

type Props = {
  sessionId: string
  status: string
  highlightCount: number
  unprocessedHighlightCount: number
  cardCount: number
  onProcessed?: () => void
  onGoToTriage?: () => void
}

export const ProcessButton = ({
  sessionId,
  status,
  highlightCount,
  unprocessedHighlightCount,
  cardCount,
  onProcessed,
  onGoToTriage,
}: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useProcessStudySession(sessionId)

  // Highlights are enriched in the background as they're selected. This button is
  // now a triage jump; the backend process route is kept as a no-op for old clients.
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
      onGoToTriage?.()
      return
    }
    mutate({ sessionId }, { onSuccess: () => onProcessed?.() })
  }

  return (
    <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 p-3 backdrop-blur'>
      <div className='mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3'>
        <span className='text-muted-foreground text-sm'>{hint}</span>
        <Button size='xl' disabled={isPending} onClick={handleClick} className='w-full sm:w-auto'>
          {label}
        </Button>
      </div>
    </div>
  )
}
