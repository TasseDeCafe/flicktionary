import { useEffect, useState } from 'react'
import { supabaseClient } from '@/lib/transport/supabase-client.ts'
import { Route as dashboardRoute } from '@/app/routes/_authenticated/_tabs/dashboard'
import { Route as loginRoute } from '@/app/routes/login/index'
import { useNavigate } from '@tanstack/react-router'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events.ts'
import { Button } from '@/components/ui/button.tsx'
import { useMutation } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'

// the user lands here after clicking on the magic link in the email.
// The email template is defined:
// dev:        backend/supabase/supabase-dev/supabase/templates/magic-link-verification.html
// dev-tunnel: backend/supabase/supabase-dev/supabase/templates/magic-link-verification.html
// prod:       https://supabase.com/dashboard/project/<project-id>/auth/templates
export const LoginEmailVerifyView = () => {
  const { t } = useLingui()

  const [isError, setIsError] = useState(false)
  const navigate = useNavigate()

  const searchParams = new URLSearchParams(location.search)
  const hash = searchParams.get('token_hash')

  useEffect(() => {
    POSTHOG_EVENTS.viewPage()
  }, [])

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
      const { error } = await supabaseClient.auth.verifyOtp({ token_hash: hash, type: 'magiclink' })
      if (error) {
        POSTHOG_EVENTS.magicLinkFailureOrExpiration()
        throw new Error('token verification failed')
      }
    },
    onSuccess: () => {
      navigate({ to: dashboardRoute.to, replace: true })
    },
    onError: () => {
      setIsError(true)
    },
  })

  const handleVerifyEmailClick = () => {
    POSTHOG_EVENTS.click('verify_email_button')
    verifyOtp()
  }

  const handleReturnToAuth = () => {
    POSTHOG_EVENTS.click('return_to_auth_button')
    navigate({ to: loginRoute.to, replace: true })
  }

  return (
    <div className='flex w-full flex-1 items-center justify-center'>
      <div className='flex w-full max-w-md flex-col gap-y-4 p-4 text-center'>
        {isError ? (
          <>
            <h1 className='text-xl font-semibold'>{t`Link expired or invalid`}</h1>
            <p className='text-gray-600'>{t`Please request a new verification link.`}</p>
            <Button onClick={handleReturnToAuth}>{t`Back to login`}</Button>
          </>
        ) : (
          <>
            <h1 className='text-xl font-semibold'>{t`Verify your email`}</h1>
            <Button onClick={handleVerifyEmailClick} disabled={isPending}>
              {isPending ? t`Verifying...` : t`Verify`}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
