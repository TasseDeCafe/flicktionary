import { Link, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import { useGetStudySessionStatus } from '@/features/sessions/api/sessions-hooks'

export const ProcessingView = () => {
  const { t } = useLingui()
  const { sessionId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/processing' })
  const closeProcessing = useModalScreenClose({ to: '/sessions' })

  const { data: status } = useGetStudySessionStatus(sessionId, 2000)
  const warnings = status?.processingWarnings ?? []

  return (
    <ModalScreen onClose={closeProcessing} title={t`Processing`}>
      <div className='mx-auto flex w-full max-w-2xl flex-col gap-4 overflow-y-auto px-4 py-8'>
        <div className='bg-card flex flex-col gap-3 rounded-md border p-6'>
          <div className='font-medium'>{t`Processing has moved to the background`}</div>
          <p className='text-muted-foreground text-sm'>
            {t`Highlights are enriched as you read. Session vocabulary is available immediately.`}
          </p>
          <div className='flex gap-2'>
            <Button asChild>
              <Link to='/sessions/$sessionId/review' params={{ sessionId }}>{t`Session vocabulary`}</Link>
            </Button>
            <Button variant='outline' asChild>
              <Link to='/sessions/$sessionId' params={{ sessionId }}>{t`Back to session`}</Link>
            </Button>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className='rounded-md border bg-amber-50 p-4 text-sm dark:bg-amber-400/10'>
            <div className='font-medium text-amber-800 dark:text-amber-300'>{t`Warnings`}</div>
            <ul className='mt-1 list-disc pl-5 text-amber-700 dark:text-amber-300'>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ModalScreen>
  )
}
