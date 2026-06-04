import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useGetStudySessionStatus } from '@/features/sessions/api/sessions-hooks'

export const ProcessingView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { sessionId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/processing' })

  const { data: status } = useGetStudySessionStatus(sessionId, 2000)
  const warnings = status?.processingWarnings ?? []

  return (
    <ModalScreen onClose={() => navigate({ to: '/sessions' })} title={t`Processing`}>
      <div className='mx-auto flex w-full max-w-2xl flex-col gap-4 overflow-y-auto px-4 py-8'>
        <div className='flex flex-col gap-3 rounded-md border bg-white p-6'>
          <div className='font-medium'>{t`Processing has moved to the background`}</div>
          <p className='text-muted-foreground text-sm'>
            {t`Highlights are enriched as you read. Triage is available immediately.`}
          </p>
          <div className='flex gap-2'>
            <Button asChild>
              <Link to='/sessions/$sessionId/review' params={{ sessionId }}>{t`Go to triage`}</Link>
            </Button>
            <Button variant='outline' asChild>
              <Link to='/sessions/$sessionId' params={{ sessionId }}>{t`Back to session`}</Link>
            </Button>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className='rounded-md border bg-amber-50 p-4 text-sm'>
            <div className='font-medium text-amber-800'>{t`Warnings`}</div>
            <ul className='mt-1 list-disc pl-5 text-amber-700'>
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
