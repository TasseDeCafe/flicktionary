import { useState } from 'react'
import { supabaseClient } from '@/lib/transport/supabase-client.ts'
import { Route as dashboardRoute } from '@/app/routes/_authenticated/_app/dashboard/index'
import { Route as loginRoute } from '@/app/routes/login/index'
import { useNavigate } from '@tanstack/react-router'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events.ts'
import { Button } from '@flicktionary/ui/components/button'
import { useMutation } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'

// the user lands here after clicking on the magic link in the email.
// The email templates are defined:
// dev:        backend/supabase/supabase-dev/supabase/templates/*.html
// dev-tunnel: backend/supabase/supabase-dev-tunnel/supabase/templates/*.html
// prod:       https://supabase.com/dashboard/project/<project-id>/auth/templates
//
// Two flows share this page, distinguished by the `type` the template stamps:
// - magiclink: the normal email sign-in link
// - email_change: a guest confirming the email that converts their anonymous
//   account into a permanent one (save-progress-view.tsx) — verifying keeps
//   the same user id, so everything they saved carries over.
export const LoginEmailVerifyView = () => {
  const { t } = useLingui()

  const [isError, setIsError] = useState(false)
  const navigate = useNavigate()

  const searchParams = new URLSearchParams(location.search)
  const hash = searchParams.get('token_hash')
  const otpType = searchParams.get('type') === 'email_change' ? 'email_change' : 'magiclink'
  // Only allow same-origin relative paths (e.g. /extension-pair?nonce=...) to avoid an open redirect
  // after authentication. Anything else falls back to the default destination.
  const redirectParam = searchParams.get('redirect')
  const redirectTo =
    redirectParam && redirectParam.startsWith('/') && !redirectParam.startsWith('//') ? redirectParam : null

  const { mutate: verifyOtp, isPending } = useMutation({
    mutationFn: async () => {
      // as described in https://supabase.com/docs/guides/auth/auth-email-passwordless#signing-in-with-magic-link
      // in PKCE flow section. Note that the user can use the magic link only once (security), but he can use any device,
      // not necessarily the one he used for requesting the magic link
      //
      // the comments below might not be 100% accurate, but it should help when looking for errors
      // we need to use Supabase PKCE flow because it's more secure than the implicit flow.
      // even if the user intercepts the magic link sent by supabase,
      // after it is verified below (there's a call in the background to the supabase api) the
      // link is no longer valid, and the attacker can't hijack the user's session
      // Supabase PKCE differs from regular PKCE (often used for mobile native apps). In the normal PKCE a secret pair is generated
      // on the client side
      if (!hash) {
        POSTHOG_EVENTS.noTokenHashProvided()
        throw new Error('No token hash provided')
      }
      const { error } = await supabaseClient.auth.verifyOtp({ token_hash: hash, type: otpType })
      if (error) {
        POSTHOG_EVENTS.magicLinkFailureOrExpiration()
        throw new Error('token verification failed')
      }
    },
    onSuccess: () => {
      if (otpType === 'email_change') {
        POSTHOG_EVENTS.guestConvertedToAccount('email')
      }
      if (redirectTo) {
        // redirectTo may include a query string (e.g. the pairing nonce), which navigate({ to }) does
        // not parse — use a hard navigation to preserve it and let the auth guard re-run with the session.
        window.location.assign(redirectTo)
        return
      }
      navigate({ to: dashboardRoute.to, replace: true })
    },
    onError: () => {
      setIsError(true)
    },
  })

  const handleVerifyEmailClick = () => {
    verifyOtp()
  }

  const handleReturnToAuth = () => {
    navigate({ to: loginRoute.to, replace: true })
  }

  return (
    <div className='flex w-full flex-1 flex-col overflow-hidden'>
      <div className='flex flex-1 items-center justify-center overflow-y-auto px-4'>
        <div className='mx-auto flex w-full max-w-md flex-col gap-2 text-center'>
          {isError ? (
            <>
              <h1 className='text-2xl font-semibold tracking-tight'>{t`Link expired or invalid`}</h1>
              <p className='text-muted-foreground'>{t`Please request a new verification link.`}</p>
            </>
          ) : otpType === 'email_change' ? (
            <>
              <h1 className='text-2xl font-semibold tracking-tight'>{t`Confirm your email`}</h1>
              <p className='text-muted-foreground'>{t`Click the button below to confirm your email and save your account.`}</p>
            </>
          ) : (
            <>
              <h1 className='text-2xl font-semibold tracking-tight'>{t`Verify your email`}</h1>
              <p className='text-muted-foreground'>{t`Click the button below to finish signing in.`}</p>
            </>
          )}
        </div>
      </div>
      <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
        <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
          {isError ? (
            <Button size='xl' className='w-full' onClick={handleReturnToAuth}>
              {t`Back to login`}
            </Button>
          ) : (
            <Button size='xl' className='w-full' onClick={handleVerifyEmailClick} disabled={isPending}>
              {isPending ? t`Verifying...` : otpType === 'email_change' ? t`Confirm` : t`Verify`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
