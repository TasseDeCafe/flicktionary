import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Route as dashboardRoute } from '@/app/routes/_authenticated/_tabs/dashboard'
import { Route as loginRoute } from '@/app/routes/login/index'
import { useAuthStore, getIsSignedIn } from '@/stores/auth-store'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx'

export const AccountRemovedView = () => {
  const navigate = useNavigate()
  const isSignedIn = useAuthStore(getIsSignedIn)
  const { t } = useLingui()

  useEffect(() => {
    if (isSignedIn) {
      navigate({ to: dashboardRoute.to })
    }
  }, [isSignedIn, navigate])

  const handleTakeToSignIn = () => {
    navigate({ to: loginRoute.to, replace: true })
  }

  return (
    <div className='mx-auto flex w-full max-w-md flex-col items-center gap-4 p-4'>
      <Card className='w-full text-center'>
        <CardHeader>
          <CardTitle>{t`Account Removed`}</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <p className='text-muted-foreground'>{t`We're sorry to see you go. Your account has been successfully removed.`}</p>
          <p className='text-muted-foreground text-sm'>{t`If you'd like to create a new account, sign up again below.`}</p>
          <Button onClick={handleTakeToSignIn} className='w-full'>
            {t`Sign up`}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
