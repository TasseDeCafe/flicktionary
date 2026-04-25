import { ComponentType, useEffect } from 'react'
import { OverlayId, URL_OVERLAY_IDS } from '@/components/ui/overlay-ids'
import { SomethingWentWrongOverlayContent } from './something-went-wrong-overlay-content'
import { ResponsiveOverlay } from '@/components/ui/responsive-overlay'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { ContactUsOverlayContent } from '@/features/contact/components/contact-us-overlay-content'
import { RateLimitingOverlayContent } from './rate-limiting-overlay-content'
import { PricingOverlayContent } from '@/features/billing/components/pricing-overlay-content'
import { DeleteAccountOverlayContent } from '@/features/removals/components/delete-account-overlay-content'
import { getIsSignedIn, useAuthStore } from '@/stores/auth-store'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'
import { useRouter } from '@tanstack/react-router'
import { Route as RootRoute } from '@/app/routes/__root'

interface OverlayConfig {
  component: ComponentType
}

const OVERLAY_CONFIG: Record<OverlayId, OverlayConfig> = {
  [OverlayId.SOMETHING_WENT_WRONG]: {
    component: SomethingWentWrongOverlayContent,
  },
  [OverlayId.CONTACT_US]: {
    component: ContactUsOverlayContent,
  },
  [OverlayId.RATE_LIMITING]: {
    component: RateLimitingOverlayContent,
  },
  [OverlayId.PRICING]: {
    component: PricingOverlayContent,
  },
  [OverlayId.DELETE_ACCOUNT]: {
    component: DeleteAccountOverlayContent,
  },
}

const URL_OVERLAY_IDS_SET = new Set<string>(URL_OVERLAY_IDS)

export const OverlayController = () => {
  const isSignedIn = useAuthStore(getIsSignedIn)
  const storeIsOpen = useOverlayStore((state) => state.isOpen)
  const storeOverlayId = useOverlayStore((state) => state.overlayId)
  const closeOverlay = useOverlayStore((state) => state.closeOverlay)

  const router = useRouter()
  const { overlay: overlayParam } = RootRoute.useSearch()

  // URL-based overlay (requires sign in) - modalParam IS the overlay ID
  const urlOverlayId = overlayParam && isSignedIn ? overlayParam : null

  // Store-based overlay (only for non-URL overlays)
  const storeOverlayId_nonUrl = storeIsOpen && !URL_OVERLAY_IDS_SET.has(storeOverlayId) ? storeOverlayId : null

  // Active overlay: URL takes precedence
  const activeOverlayId = urlOverlayId ?? storeOverlayId_nonUrl
  const isOverlayVisible = !!activeOverlayId
  const ActiveOverlayContent = activeOverlayId ? OVERLAY_CONFIG[activeOverlayId as OverlayId]?.component : null

  useEffect(() => {
    if (activeOverlayId) {
      POSTHOG_EVENTS.viewOverlay(activeOverlayId)
    }
  }, [activeOverlayId])

  const handleCloseOverlay = () => {
    if (overlayParam) {
      // Close URL overlay by clearing the param
      const currentSearch = { ...router.state.location.search }
      delete currentSearch.overlay
      void router.navigate({
        to: router.state.location.pathname,
        search: currentSearch,
      })
    } else {
      closeOverlay()
    }
  }

  return (
    <ResponsiveOverlay open={isOverlayVisible} onOpenChange={(open) => !open && handleCloseOverlay()}>
      {ActiveOverlayContent && <ActiveOverlayContent />}
    </ResponsiveOverlay>
  )
}
