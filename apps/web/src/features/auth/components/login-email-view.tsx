import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Route as loginEmailRoute } from '@/app/routes/login/email/index'
import { Route as loginRoute } from '@/app/routes/login/index'
import { z } from 'zod'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events.ts'
import { Button } from '@flicktionary/ui/components/button'
import { Route as loginEmailSentRoute } from '@/app/routes/login/email/sent'
import { useSendVerificationEmail } from '@/features/auth/api/authentication-hooks'
import { useLingui } from '@lingui/react/macro'
import { useTrackingStore } from '@/stores/tracking-store'
import { useShallow } from 'zustand/react/shallow'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { WizardStepHeading } from '@/components/ui/wizard-shell'

const emailSchema = z.email()

export const LoginEmailView = () => {
  const { t } = useLingui()

  const navigate = useNavigate()
  const { redirect, email: emailParam } = loginEmailRoute.useSearch()
  const [email, setEmail] = useState(emailParam ?? '')
  const [emailError, setEmailError] = useState('')
  const trackingParams = useTrackingStore(
    useShallow((state) => ({
      referral: state.referral,
      utmSource: state.utmSource,
      utmMedium: state.utmMedium,
      utmCampaign: state.utmCampaign,
      utmTerm: state.utmTerm,
      utmContent: state.utmContent,
    }))
  )

  const validateEmail = (email: string) => {
    return emailSchema.safeParse(email).success
  }

  useEffect(() => {
    POSTHOG_EVENTS.viewPage()
  }, [])

  const { mutate: sendVerificationEmail, isPending } = useSendVerificationEmail({
    onSuccess: () => {
      navigate({ to: loginEmailSentRoute.to, search: { email, redirect } })
    },
  })

  const handleBack = () => {
    navigate({ to: loginRoute.to, search: { redirect } })
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!validateEmail(email)) {
      setEmailError(t`Please enter a valid email address`)
      return
    }

    POSTHOG_EVENTS.click('send_verification_email_button')
    sendVerificationEmail({
      email,
      redirect,
      referral: trackingParams.referral,
      platform: 'web',
      utmSource: trackingParams.utmSource,
      utmMedium: trackingParams.utmMedium,
      utmCampaign: trackingParams.utmCampaign,
      utmTerm: trackingParams.utmTerm,
      utmContent: trackingParams.utmContent,
    })
  }

  const handleEmailChange = (e: ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value)
    setEmailError('')
  }

  return (
    <ModalScreen onClose={handleBack} closeIcon='chevron'>
      <form onSubmit={handleSubmit} className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex-1 overflow-y-auto px-4 pt-6 pb-28'>
          <div className='mx-auto flex w-full max-w-md flex-col gap-6 md:max-w-lg'>
            <WizardStepHeading
              title={t`What's your email?`}
              subtitle={t`We'll email you a magic link to sign in — no password needed.`}
            />
            <div className='w-full space-y-1'>
              <input
                type='email'
                id='email'
                name='email'
                autoComplete='username email'
                enterKeyHint='go'
                autoFocus
                placeholder={t`Email address`}
                value={email}
                onChange={handleEmailChange}
                className='border-input placeholder-muted-foreground focus:border-ring focus:ring-ring h-10 w-full rounded-md border px-3 py-2 focus:ring-1 focus:outline-none'
              />
              {emailError && <p className='text-destructive text-xs'>{emailError}</p>}
            </div>
          </div>
        </div>
        <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
          <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
            <Button type='submit' size='xl' className='w-full' disabled={isPending}>
              {isPending ? t`Sending...` : t`Continue`}
            </Button>
          </div>
        </div>
      </form>
    </ModalScreen>
  )
}
