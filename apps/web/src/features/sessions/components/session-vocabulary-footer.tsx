import { Loader2 } from 'lucide-react'
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
}

export const SessionVocabularyFooter = ({
  sessionId,
  highlightCount,
  isGeneratingCandidates = false,
  onOpenSessionVocabulary,
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
        <Button size='xl' disabled={isPending} onClick={handleClick} className='w-full sm:w-auto'>
          {label}
        </Button>
      </div>
    </div>
  )
}
