import { useEffect, useRef } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useStartPracticeSession } from '../api/practice-hooks'
import { PracticeLoader } from './practice-loader'

export const PracticeStartView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { lang } = useSearch({ from: '/_authenticated/_app/practice/start' })
  const { mutate: startSession, isError } = useStartPracticeSession()
  const triggered = useRef(false)

  useEffect(() => {
    if (triggered.current) return
    triggered.current = true
    startSession(
      { targetLanguage: lang },
      {
        onSuccess: (response) => {
          void navigate({
            to: '/practice/$practiceSessionId',
            params: { practiceSessionId: response.data.sessionId },
            replace: true,
          })
        },
      }
    )
  }, [lang, navigate, startSession])

  const close = () => void navigate({ to: '/practice' })

  return (
    <ModalScreen onClose={close} closeIcon='x' title={t`Practice`}>
      {isError ? (
        <div className='flex flex-1 items-center justify-center px-4'>
          <div className='flex flex-col items-center gap-3 text-center'>
            <p className='text-sm text-gray-700'>{t`Couldn't start the session. Please try again.`}</p>
            <Button onClick={close}>{t`Back to Practice`}</Button>
          </div>
        </div>
      ) : (
        <PracticeLoader label={t`Preparing the session…`} />
      )}
    </ModalScreen>
  )
}
