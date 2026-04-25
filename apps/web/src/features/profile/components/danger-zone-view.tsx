import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'
import { Route as profileRoute } from '@/app/routes/_authenticated/_tabs/profile'
import { ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { OverlayId } from '@/components/ui/overlay-ids'

export const DangerZoneView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const openOverlay = useOverlayStore((state) => state.openOverlay)

  return (
    <div className='flex min-h-screen flex-col bg-red-50'>
      {/* Header */}
      <header className='sticky top-0 z-10 flex h-14 items-center border-b border-red-200 bg-red-50 px-4'>
        <button
          onClick={() => navigate({ to: profileRoute.to })}
          className='flex h-10 w-10 items-center justify-center rounded-lg hover:bg-red-100'
        >
          <ArrowLeft className='h-6 w-6 text-red-800' />
        </button>
        <h1 className='ml-2 text-lg font-semibold text-red-800'>{t`Danger Zone`}</h1>
      </header>

      {/* Main content */}
      <main className='flex flex-1 flex-col p-4'>
        {/* Warning text section */}
        <div className='mb-6 px-2'>
          <h2 className='mb-2 text-lg font-medium text-red-800'>{t`Warning`}</h2>
          <p className='text-red-600'>{t`Actions in this section can lead to permanent data loss.`}</p>
        </div>

        {/* Danger Zone options */}
        <Card className='border-red-200 bg-white'>
          <CardHeader className='pb-0'>
            <CardTitle className='text-base text-red-600'>{t`Delete my account`}</CardTitle>
            <CardDescription>{t`Permanently delete your account and all associated data`}</CardDescription>
          </CardHeader>
          <CardContent className='pt-4'>
            <Button variant='destructive' onClick={() => openOverlay(OverlayId.DELETE_ACCOUNT)} className='w-full'>
              {t`Delete my account`}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
