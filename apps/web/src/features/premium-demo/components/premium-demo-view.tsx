import { useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { useNeedsSubscription } from '@/features/billing/hooks/use-needs-subscription'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'
import { useEffect } from 'react'
import { OverlayId } from '@/components/ui/overlay-ids'
import { Route as dashboardRoute } from '@/app/routes/_authenticated/_tabs/dashboard'
import { FullViewLoader } from '@/components/ui/full-view-loader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export const PremiumDemoView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { needsSubscription, isFetching } = useNeedsSubscription()
  const openOverlay = useOverlayStore((state) => state.openOverlay)

  useEffect(() => {
    if (!isFetching && needsSubscription) {
      openOverlay(OverlayId.PRICING)
      navigate({ to: dashboardRoute.to })
    }
  }, [needsSubscription, isFetching, openOverlay, navigate])

  if (isFetching) {
    return <FullViewLoader />
  }

  if (needsSubscription) {
    return <FullViewLoader />
  }

  return (
    <div className='flex min-h-screen flex-col'>
      {/* Header */}
      <header className='sticky top-0 z-10 flex h-14 items-center border-b px-4'>
        <button
          onClick={() => navigate({ to: dashboardRoute.to })}
          className='flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100'
        >
          <ArrowLeft className='h-6 w-6' />
        </button>
        <h1 className='ml-2 text-lg font-semibold'>{t`Premium Demo`}</h1>
      </header>

      {/* Main content */}
      <main className='flex flex-1 items-center justify-center p-4'>
        <Card className='w-full max-w-md text-center'>
          <CardHeader>
            <CardTitle className='text-2xl'>{t`Premium Features`}</CardTitle>
            <CardDescription>
              {t`This screen is only accessible to subscribed users. You can showcase premium features here.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant='outline' onClick={() => navigate({ to: dashboardRoute.to })}>
              {t`Go Back`}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
