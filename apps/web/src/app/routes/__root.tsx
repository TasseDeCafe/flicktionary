import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { OverlayController } from '@/features/overlay/components/overlay-controller'
import { Toaster } from 'sonner'
import { z } from 'zod'
import { URL_OVERLAY_IDS } from '@/components/ui/overlay-ids'
import { getConfig } from '@/config/environment-config'

const rootSearchSchema = z.object({
  // some overlays should be accessible via URL
  overlay: z.enum(URL_OVERLAY_IDS).optional(),
})

const RootComponent = () => (
  <>
    <OverlayController />
    <Toaster />
    <Outlet />
    {getConfig().showDevTools && <TanStackRouterDevtools position='bottom-right' />}
  </>
)

export const Route = createRootRoute({
  component: RootComponent,
  validateSearch: rootSearchSchema,
})
