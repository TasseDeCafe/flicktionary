import { supabaseClient } from '@/lib/transport/supabase-client.ts'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Route as dashboardRoute } from '@/app/routes/_authenticated/_tabs/dashboard'
import { Route as loginEmailRoute } from '@/app/routes/login/email/index'
import { Route as loginRoute } from '@/app/routes/login/index'
import { AuthError } from '@supabase/supabase-js'
import { toast } from 'sonner'
import googleSvg from '@/assets/svg/google.svg'
import appleSvg from '@/assets/svg/apple.svg'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { Button } from '@/components/ui/button'
import { Mail } from 'lucide-react'
import { FEATURES } from '@template-app/core/features'
import { shouldShowSignInWithGoogle } from '../utils/auth-utils'
import { useLingui } from '@lingui/react/macro'
import { getIsSignedIn, useAuthStore } from '@/stores/auth-store'

export const LoginView = () => {
  const { t } = useLingui()

  const { redirect } = loginRoute.useSearch()
  const navigate = useNavigate()
  const redirectTo = redirect || dashboardRoute.to
  const isSignedIn = useAuthStore(getIsSignedIn)

  useEffect(() => {
    if (isSignedIn) {
      navigate({ to: redirectTo })
    }
  }, [navigate, isSignedIn, redirectTo])

  useEffect(() => {
    POSTHOG_EVENTS.viewPage()
  }, [])

  const continueWithGoogle = async () => {
    const { error }: { error: AuthError | null } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        queryParams: {
          access_type: 'offline',
        },
        redirectTo: window.location.origin + redirectTo,
      },
    })
    if (error) {
      toast.error(t`Authentication failed`)
    }
  }

  const continueWithApple = async () => {
    const { error }: { error: AuthError | null } = await supabaseClient.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: window.location.origin + redirectTo,
      },
    })
    if (error) {
      toast.error(t`Authentication failed`)
    }
  }

  const handleContinueWithGoogleClick = () => {
    POSTHOG_EVENTS.click('continue_with_google_button')
    continueWithGoogle().then()
  }

  const handleContinueWithAppleClick = () => {
    POSTHOG_EVENTS.click('continue_with_apple_button')
    continueWithApple().then()
  }

  const handleContinueWithEmailClick = () => {
    POSTHOG_EVENTS.click('continue_with_email_button')
    navigate({ to: loginEmailRoute.to })
  }

  if (!isSignedIn) {
    return (
      <div className='flex w-full flex-1 items-center justify-center'>
        <div className='flex w-full max-w-md flex-col gap-y-4 p-4'>
          <Button variant='outline' onClick={handleContinueWithEmailClick}>
            <Mail height={20} width={20} />
            <span>{t`Continue with Email`}</span>
          </Button>
          {FEATURES.GOOGLE_AUTH && shouldShowSignInWithGoogle() && (
            <Button onClick={handleContinueWithGoogleClick}>
              <img src={googleSvg} alt='google' height={20} width={20} />
              <span>{t`Continue with Google`}</span>
            </Button>
          )}
          {FEATURES.APPLE_AUTH && (
            <Button variant='secondary' onClick={handleContinueWithAppleClick}>
              <img src={appleSvg} alt='apple' height={18} width={18} />
              <span>{t`Continue with Apple`}</span>
            </Button>
          )}
        </div>
      </div>
    )
  }
}
