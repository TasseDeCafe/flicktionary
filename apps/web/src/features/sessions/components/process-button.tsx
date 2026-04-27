import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { useProcessStudySession } from '../api/sessions-hooks'

type Props = {
  sessionId: string
  status: string
  highlightCount: number
  onProcessed?: () => void
}

export const ProcessButton = ({ sessionId, status, highlightCount, onProcessed }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useProcessStudySession(sessionId)

  // The orchestrator is idempotent: re-running on a processed/exported session
  // only hits the per-highlight pass for highlights that don't yet have a card,
  // so this same button doubles as "process new highlights" after the first run.
  const isReprocess = status === 'processed' || status === 'exported'
  const canTrigger = (status === 'active' || isReprocess) && highlightCount > 0
  const showFooter = status === 'active' || isReprocess

  if (!showFooter) {
    return null
  }

  const hint = (() => {
    if (highlightCount === 0) return t`Highlight at least one chunk to process.`
    if (isReprocess) return t`${highlightCount} highlight(s) total. Already-processed ones are skipped.`
    return t`${highlightCount} highlight(s) ready.`
  })()

  const label = (() => {
    if (isPending) return t`Starting…`
    if (isReprocess) return t`Process new highlights`
    return t`Process`
  })()

  return (
    <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 p-3 backdrop-blur'>
      <div className='mx-auto flex max-w-4xl items-center justify-between gap-3'>
        <span className='text-muted-foreground text-sm'>{hint}</span>
        <Button
          disabled={!canTrigger || isPending}
          onClick={() => mutate({ sessionId }, { onSuccess: () => onProcessed?.() })}
        >
          {label}
        </Button>
      </div>
    </div>
  )
}
