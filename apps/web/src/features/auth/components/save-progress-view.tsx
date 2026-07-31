import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'
import { Navigate } from '@tanstack/react-router'
import { z } from 'zod'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { FullViewLoader } from '@flicktionary/ui/components/full-view-loader'
import googleSvg from '@/assets/svg/google.svg'
import { FEATURES } from '@flicktionary/core/features'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import { WizardStepHeading } from '@/components/ui/wizard-shell'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { getIsAnonymous, useAuthStore } from '@/stores/auth-store'
import { Route as saveProgressRoute } from '@/app/routes/_authenticated/_app/save-progress'
import { shouldShowSignInWithGoogle } from '../utils/auth-utils'
import { classifyEmailConversionError, parseOAuthLinkError } from '../utils/conversion-errors'

const emailSchema = z.email()

// Long enough to discourage hammering Supabase's email endpoint, short enough
// that a user staring at an empty inbox isn't stranded.
const RESEND_COOLDOWN_SECONDS = 30

type ViewState = 'linking' | 'form' | 'sent' | 'success' | 'conflict'

// Guest → account conversion (email or Google) keeping the same user id, so
// sessions, vocabulary, and SRS state carry over untouched. The normal login
// flow must never be offered to a guest: signing in there creates a different
// user and orphans everything the guest saved.
export const SaveProgressView = () => {
  const { t } = useLingui()
  const handleClose = useModalScreenClose({ to: '/dashboard' })
  const isAnonymous = useAuthStore(getIsAnonymous)
  const { linked } = saveProgressRoute.useSearch()

  const [state, setState] = useState<ViewState>(linked === 'google' ? 'linking' : 'form')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [cooldownSeconds, setCooldownSeconds] = useState(0)

  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const timer = setTimeout(() => setCooldownSeconds((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldownSeconds])

  // Landing back from the Google OAuth dance. linkIdentity reports failures on
  // the redirect URL, not as a thrown error — read those before celebrating.
  const handledLinkReturnRef = useRef(false)
  useEffect(() => {
    if (linked !== 'google' || handledLinkReturnRef.current) return
    handledLinkReturnRef.current = true

    const oauthError = parseOAuthLinkError(window.location.search, window.location.hash)
    if (oauthError === 'identity_exists') {
      setState('conflict')
      return
    }
    if (oauthError) {
      setState('form')
      toast.error(t`Could not connect your Google account. Please try again.`)
      return
    }
    void (async () => {
      // Linking an identity flips is_anonymous on the user, but the JWT claim
      // only updates on token refresh — and the backend drops its guest
      // restrictions off that claim, so refresh before declaring success.
      const { data } = await supabaseClient.auth.refreshSession()
      if (data.session && !data.session.user.is_anonymous) {
        POSTHOG_EVENTS.guestConvertedToAccount('google')
        setState('success')
      } else {
        setState('form')
        toast.error(t`Could not connect your Google account. Please try again.`)
      }
    })()
  }, [linked, t])

  const { mutate: submitEmail, isPending } = useMutation({
    mutationFn: async (emailToSubmit: string) => {
      // updateUser (not signInWithOtp!) keeps the guest's user id: it attaches
      // the email to the existing anonymous user and sends a confirmation
      // using the email_change template. The trailing '?' is load-bearing —
      // the template concatenates `token_hash=...&type=email_change` onto it.
      const { data, error } = await supabaseClient.auth.updateUser(
        { email: emailToSubmit },
        { emailRedirectTo: `${window.location.origin}/login/email/verify?` }
      )
      if (error) throw error
      return data.user
    },
    onSuccess: (user) => {
      // When the server runs with email confirmations disabled (GoTrue
      // autoconfirm — the local stacks' enable_confirmations = false), the
      // change applies instantly and no email exists to wait for: new_email
      // is only set while a confirmation is pending. setState must run before
      // refreshSession — the refreshed session flips isAnonymous, and the
      // 'form' state would bounce to the dashboard before showing success.
      if (!user.new_email) {
        POSTHOG_EVENTS.guestConvertedToAccount('email')
        setState('success')
        void supabaseClient.auth.refreshSession()
        return
      }
      POSTHOG_EVENTS.guestConversionEmailSent()
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS)
      setState('sent')
    },
    onError: (error) => {
      const kind = classifyEmailConversionError(error)
      if (kind === 'email_exists') {
        setState('conflict')
        return
      }
      if (kind === 'rate_limited') {
        toast.error(t`Too many attempts — please wait a moment before trying again.`)
        return
      }
      toast.error(t`Could not send the confirmation email. Please try again.`)
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!emailSchema.safeParse(email).success) {
      setEmailError(t`Please enter a valid email address`)
      return
    }
    submitEmail(email)
  }

  const handleEmailChange = (e: ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value)
    setEmailError('')
  }

  const handleContinueWithGoogle = async () => {
    const { error } = await supabaseClient.auth.linkIdentity({
      provider: 'google',
      options: {
        queryParams: {
          access_type: 'offline',
        },
        redirectTo: `${window.location.origin}/save-progress?linked=google`,
      },
    })
    // Only pre-redirect failures (e.g. manual linking disabled server-side)
    // surface here; post-redirect ones come back on the URL.
    if (error) {
      toast.error(t`Authentication failed`)
    }
  }

  const handleLogInInstead = () => {
    // The guest session has to go: the login page bounces any signed-in
    // session straight back into the app. Hard navigation for a clean slate.
    void useAuthStore.getState().signOut(() => {
      window.location.assign('/login')
    })
  }

  // A signed-up user has nothing to convert. The check is skipped mid-flow:
  // the Google return path ('linking' → 'success') and a 'sent'/'conflict'
  // screen must not be yanked away when the session turns non-anonymous.
  if (!isAnonymous && state === 'form') {
    return <Navigate to='/dashboard' replace />
  }

  return (
    <ModalScreen onClose={handleClose}>
      {state === 'linking' && <FullViewLoader />}

      {state === 'form' && (
        <form onSubmit={handleSubmit} className='flex flex-1 flex-col overflow-hidden'>
          <div className='flex-1 overflow-y-auto px-4 pt-6 pb-28'>
            <div className='mx-auto flex w-full max-w-md flex-col gap-6 md:max-w-lg'>
              <WizardStepHeading
                title={t`Create a free account`}
                subtitle={t`You're browsing as a guest — everything you save lives only in this browser and is lost if its data is cleared. Add an email or Google account to keep your progress.`}
              />
              {FEATURES.GOOGLE_AUTH && shouldShowSignInWithGoogle() && (
                <>
                  <Button type='button' variant='outline' size='xl' onClick={() => void handleContinueWithGoogle()}>
                    <img src={googleSvg} alt='google' height={20} width={20} />
                    <span>{t`Continue with Google`}</span>
                  </Button>
                  <div className='flex items-center gap-3'>
                    <div className='bg-border h-px flex-1' />
                    <span className='text-muted-foreground text-xs font-medium uppercase'>{t`or`}</span>
                    <div className='bg-border h-px flex-1' />
                  </div>
                </>
              )}
              <div className='w-full space-y-1'>
                <input
                  type='email'
                  id='email'
                  name='email'
                  autoComplete='username email'
                  enterKeyHint='go'
                  placeholder={t`Email address`}
                  value={email}
                  onChange={handleEmailChange}
                  className='border-input placeholder-muted-foreground focus:border-ring focus:ring-ring h-10 w-full rounded-md border px-3 py-2 text-base focus:ring-1 focus:outline-none'
                />
                {emailError && <p className='text-destructive text-xs'>{emailError}</p>}
              </div>
            </div>
          </div>
          <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
            <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
              <Button type='submit' size='xl' className='w-full' disabled={isPending}>
                {isPending ? t`Sending...` : t`Continue with Email`}
              </Button>
            </div>
          </div>
        </form>
      )}

      {state === 'sent' && (
        <div className='flex flex-1 flex-col overflow-hidden'>
          <div className='flex-1 overflow-y-auto px-4 pt-6 pb-28'>
            <div className='mx-auto flex w-full max-w-md flex-col gap-6 md:max-w-lg'>
              <WizardStepHeading
                title={t`Check your inbox`}
                subtitle={t`We sent a confirmation link to ${email}. Open it to finish creating your account.`}
              />
              <button
                type='button'
                className='text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4'
                onClick={() => setState('form')}
              >
                {t`Use a different email`}
              </button>
            </div>
          </div>
          <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
            <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
              <Button
                size='xl'
                variant='outline'
                className='w-full'
                disabled={isPending || cooldownSeconds > 0}
                onClick={() => submitEmail(email)}
              >
                {cooldownSeconds > 0 ? t`Resend email (${cooldownSeconds}s)` : t`Resend email`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {state === 'success' && (
        <div className='flex flex-1 flex-col overflow-hidden'>
          <div className='flex flex-1 items-center justify-center overflow-y-auto px-4'>
            <div className='mx-auto flex w-full max-w-md flex-col gap-2 text-center'>
              <h1 className='text-2xl font-semibold tracking-tight'>{t`Your progress is saved`}</h1>
              <p className='text-muted-foreground'>{t`Your account now works on any device — sign in with the same method next time.`}</p>
            </div>
          </div>
          <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
            <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
              <Button size='xl' className='w-full' onClick={handleClose}>
                {t`Continue`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {state === 'conflict' && (
        <div className='flex flex-1 flex-col overflow-hidden'>
          <div className='flex flex-1 items-center justify-center overflow-y-auto px-4'>
            <div className='mx-auto flex w-full max-w-md flex-col gap-2 text-center'>
              <h1 className='text-2xl font-semibold tracking-tight'>{t`You already have an account`}</h1>
              <p className='text-muted-foreground'>{t`This email or Google account already belongs to another Flicktionary account. Log in to it instead — your guest progress can't be transferred.`}</p>
              <button
                type='button'
                className='text-muted-foreground hover:text-foreground mx-auto mt-2 text-sm underline underline-offset-4'
                onClick={() => setState('form')}
              >
                {t`Go back`}
              </button>
            </div>
          </div>
          <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
            <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
              <Button size='xl' className='w-full' onClick={handleLogInInstead}>
                {t`Log in`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ModalScreen>
  )
}
