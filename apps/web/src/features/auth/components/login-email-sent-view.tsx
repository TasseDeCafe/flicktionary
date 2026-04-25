import { useEffect } from 'react'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { useLingui } from '@lingui/react/macro'
import { Route as EmailSentRoute } from '@/app/routes/login/email/sent'

export const LoginEmailSentView = () => {
  const { t } = useLingui()

  const { email: emailParam } = EmailSentRoute.useSearch()
  const email = emailParam || t`your email address`

  useEffect(() => {
    POSTHOG_EVENTS.viewPage()
  }, [])

  return (
    <div className='flex w-full flex-1 items-center justify-center'>
      <div className='flex w-full max-w-md flex-col gap-y-4 p-4 text-center'>
        <h1 className='text-xl font-semibold'>{t`Check your email`}</h1>
        <p className='text-gray-600'>{t`We've sent a verification link to:`}</p>
        <p className='font-medium'>{email}</p>
        <p className='text-gray-600'>{t`Click the link in the email to continue.`}</p>
      </div>
    </div>
  )
}
