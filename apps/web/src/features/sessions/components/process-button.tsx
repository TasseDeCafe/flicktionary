import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { useGetUserPrefs, useProcessStudySession } from '../api/sessions-hooks'

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
  const { data: prefs } = useGetUserPrefs()
  const llmHighlightsEnabled = prefs?.llmHighlightsEnabled ?? true

  // The orchestrator is idempotent: re-running on a processed/exported session
  // only hits the basic-data pass for highlights that don't yet have a card,
  // so this same button doubles as "process new highlights" after the first run.
  // First-pass with zero highlights is allowed *only* when LLM-suggested chunks
  // are enabled — otherwise there's literally nothing to process. Re-process is
  // also allowed when zero cards exist (previous run failed silently — the user
  // needs a way to retry).
  const isReprocess = status === 'processed' || status === 'exported'
  const isFailed = status === 'failed'
  const noPriorOutput = cardCount === 0
  const hasSomethingToProcess = highlightCount > 0 || llmHighlightsEnabled
  // On a processed/exported session with cards already produced, "nothing new"
  // means no highlights are waiting for a basic-data pass. The button degrades
  // to a triage shortcut so the label doesn't claim there's work to do.
  const isReprocessNothingNew = isReprocess && !noPriorOutput && unprocessedHighlightCount === 0
  const canTrigger =
    (status === 'active' && hasSomethingToProcess) ||
    (isFailed && hasSomethingToProcess) ||
    (isReprocess && (highlightCount > 0 || (noPriorOutput && hasSomethingToProcess)))
  const showFooter = status === 'active' || isReprocess || isFailed

  if (!showFooter) {
    return null
  }

  const hint = (() => {
    if (!hasSomethingToProcess) {
      return t`LLM-suggested terms are off. Highlight at least one term to process this session.`
    }
    if (isFailed) return t`Previous run failed. Click to retry.`
    if (isReprocess && noPriorOutput) return t`Previous run produced no cards. Click to retry.`
    if (status === 'active' && highlightCount === 0) {
      return t`No highlights — the LLM will suggest terms based on your level.`
    }
    if (isReprocessNothingNew) return t`All highlights have been processed.`
    if (isReprocess) return t`${unprocessedHighlightCount} new highlight(s) to process.`
    return t`${highlightCount} highlight(s) ready.`
  })()

  const label = (() => {
    if (isPending) return t`Starting…`
    if (isFailed || (isReprocess && noPriorOutput)) return t`Retry processing`
    if (isReprocessNothingNew) return t`Go to triage`
    if (isReprocess) return t`Process new highlights`
    return t`Process`
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
      <div className='mx-auto flex max-w-4xl items-center justify-between gap-3'>
        <span className='text-muted-foreground text-sm'>{hint}</span>
        <Button disabled={(!canTrigger && !isReprocessNothingNew) || isPending} onClick={handleClick}>
          {label}
        </Button>
      </div>
    </div>
  )
}
