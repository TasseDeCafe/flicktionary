import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { OverlayController } from '@/features/overlay/components/overlay-controller'
import { Toaster } from 'sonner'
import { z } from 'zod'
import { URL_OVERLAY_IDS } from '@flicktionary/ui/components/overlay-ids'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { getConfig } from '@/config/environment-config'

const rootSearchSchema = z.object({
  // some overlays should be accessible via URL
  overlay: z.enum(URL_OVERLAY_IDS).optional(),
})

const RootComponent = () => {
  // On mobile, dock toasts at the top so they don't sit over the bottom action buttons.
  const isMobile = useIsMobile()

  return (
    <>
      <OverlayController />
      <Toaster position={isMobile ? 'top-center' : 'bottom-right'} />
      <Outlet />
      {getConfig().showDevTools && <TanStackRouterDevtools position='bottom-right' />}
    </>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
  validateSearch: rootSearchSchema,
})
