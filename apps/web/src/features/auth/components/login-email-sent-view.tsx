import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Route as EmailSentRoute } from '@/app/routes/login/email/sent'
import { Route as loginEmailRoute } from '@/app/routes/login/email/index'
import { useSendVerificationEmail } from '@/features/auth/api/authentication-hooks'
import { Button } from '@flicktionary/ui/components/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { toast } from 'sonner'
import { useTrackingStore } from '@/stores/tracking-store'
import { useShallow } from 'zustand/react/shallow'

// Long enough to discourage hammering the endpoint, short enough that a user
// staring at an empty inbox isn't stranded.
const RESEND_COOLDOWN_SECONDS = 30

export const LoginEmailSentView = () => {
  const { t } = useLingui()

  const navigate = useNavigate()
  const { email: emailParam, redirect } = EmailSentRoute.useSearch()
  const email = emailParam || t`your email address`
  const [cooldownSeconds, setCooldownSeconds] = useState(RESEND_COOLDOWN_SECONDS)
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

  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const timer = setTimeout(() => setCooldownSeconds((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldownSeconds])

  const { mutate: sendVerificationEmail, isPending } = useSendVerificationEmail({
    onSuccess: () => {
      toast.success(t`Verification email sent`)
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS)
    },
  })

  const handleResend = () => {
    if (!emailParam) return
    sendVerificationEmail({
      email: emailParam,
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

  // Back to the email step with the address prefilled, so a typo'd email can
  // be corrected instead of retyped.
  const handleBack = () => {
    navigate({ to: loginEmailRoute.to, search: { redirect, email: emailParam } })
  }

  return (
    <ModalScreen onClose={handleBack} closeIcon='chevron'>
      <div className='flex flex-1 items-center justify-center overflow-y-auto px-4'>
        <div className='mx-auto flex w-full max-w-md flex-col gap-2 text-center'>
          <h1 className='text-2xl font-semibold tracking-tight'>{t`Check your email`}</h1>
          <p className='text-muted-foreground'>{t`We've sent a verification link to:`}</p>
          <p className='font-medium'>{email}</p>
          <p className='text-muted-foreground'>{t`Click the link in the email to continue.`}</p>
          {emailParam && (
            <Button
              variant='ghost'
              size='lg'
              className='mt-4'
              onClick={handleResend}
              disabled={isPending || cooldownSeconds > 0}
            >
              {cooldownSeconds > 0
                ? t`Resend email in ${cooldownSeconds}s`
                : isPending
                  ? t`Sending...`
                  : t`Resend email`}
            </Button>
          )}
        </div>
      </div>
    </ModalScreen>
  )
}
