import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { OverlayId } from '@/components/ui/overlay-ids'
import { ModalScreen } from '@/features/navigation/components/modal-screen'

export const DangerZoneView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const openOverlay = useOverlayStore((state) => state.openOverlay)

  return (
    <ModalScreen onClose={() => navigate({ to: '/more' })} closeIcon='chevron' title={t`Danger Zone`}>
      <main className='flex-1 overflow-y-auto bg-red-50 p-4'>
        <div className='mb-6 px-2'>
          <h2 className='mb-2 text-lg font-medium text-red-800'>{t`Warning`}</h2>
          <p className='text-red-600'>{t`Actions in this section can lead to permanent data loss.`}</p>
        </div>

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
    </ModalScreen>
  )
}
