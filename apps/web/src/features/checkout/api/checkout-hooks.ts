import { USER_FACING_ERROR_CODE } from '@template-app/core/constants/user-facing-error-code'
import { useMutation } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { useLingui } from '@lingui/react/macro'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'

export const useCheckoutMutation = () => {
  const { t } = useLingui()
  const openErrorOverlay = useOverlayStore((state) => state.openErrorOverlay)

  return useMutation(
    orpcQuery.checkout.createCheckoutSession.mutationOptions({
      onSuccess: (response) => {
        window.location.href = response.data.url ?? ''
      },
      onError: () => {
        openErrorOverlay(USER_FACING_ERROR_CODE.CHECKOUT_ERROR)
      },
      meta: {
        errorMessage: t`Failed to create checkout session`,
        showErrorModal: false, // We are already showing an error modal in onError here.
        showErrorToast: false,
      },
    })
  )
}
