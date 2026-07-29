import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useLingui } from '@lingui/react/macro'
import { SuccessCheck } from '@/components/ui/success-check'
import { Route as dashboardRoute } from '@/app/routes/_authenticated/_app/dashboard/index'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { Button } from '@flicktionary/ui/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@flicktionary/ui/components/card'

export const CheckoutSuccessView = () => {
  const navigate = useNavigate()
  const { t } = useLingui()

  useEffect(() => {
    POSTHOG_EVENTS.viewPage()
    POSTHOG_EVENTS.subscriptionActivated()
  }, [])

  return (
    <div className='flex w-full flex-1 items-center justify-center p-4'>
      <Card className='w-full max-w-md text-center'>
        <CardHeader>
          <div className='mx-auto mb-4'>
            <SuccessCheck />
          </div>
          <CardTitle className='text-2xl'>{t`Subscription Successful!`}</CardTitle>
          <CardDescription>{t`You are now subscribed to Premium!`}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className='text-muted-foreground'>{t`Enjoy unlimited access to all our premium features and content.`}</p>
        </CardContent>
        <CardFooter>
          <Button className='w-full' onClick={() => navigate({ to: dashboardRoute.to })}>
            {t`Go to Dashboard`}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
