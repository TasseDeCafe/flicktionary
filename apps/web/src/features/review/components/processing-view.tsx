import { useEffect } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useGetStudySessionStatus, useProcessStudySession } from '@/features/sessions/api/sessions-hooks'

export const ProcessingView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { sessionId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/processing' })

  const { data: status } = useGetStudySessionStatus(sessionId, 2000)
  const { mutate: retry, isPending: isRetrying } = useProcessStudySession(sessionId)

  useEffect(() => {
    if (status?.status === 'processed' || status?.status === 'exported') {
      void navigate({ to: '/sessions/$sessionId/review', params: { sessionId } })
    }
  }, [status?.status, navigate, sessionId])

  const isFailed = status?.status === 'failed'
  const warnings = status?.processingWarnings ?? []

  return (
    <div className='mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8'>
      {!isFailed && (
        <div className='flex items-center gap-3 rounded-md border bg-white p-6'>
          <Loader2 className='h-6 w-6 animate-spin text-yellow-600' />
          <div>
            <div className='font-medium'>{t`Processing your session…`}</div>
            <div className='text-muted-foreground text-sm'>
              {t`This usually takes 1–2 minutes. You can leave this page and come back.`}
            </div>
          </div>
        </div>
      )}

      {isFailed && (
        <div className='flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-6'>
          <div className='font-medium text-red-700'>{t`Processing failed`}</div>
          <p className='text-sm text-red-700'>{t`Something went wrong. You can retry or go back to the session.`}</p>
          <div className='flex gap-2'>
            <Button onClick={() => retry({ sessionId })} disabled={isRetrying}>
              {isRetrying ? t`Retrying…` : t`Retry`}
            </Button>
            <Button variant='outline' asChild>
              <Link to='/sessions/$sessionId' params={{ sessionId }}>{t`Back to session`}</Link>
            </Button>
          </div>
        </div>
      )}

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
  )
}
