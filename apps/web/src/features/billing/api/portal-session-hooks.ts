import { useMutation } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { useLingui } from '@lingui/react/macro'

export const useCreateCustomerPortalSession = () => {
  const { t } = useLingui()

  return useMutation(
    orpcQuery.portalSession.createCustomerPortalSession.mutationOptions({
      onSuccess: (response) => {
        window.location.href = response.data.url
      },
      meta: {
        errorMessage: t`Unable to access your billing section at the moment. Please try again later or contact support if the issue persists.`,
        showErrorToast: true,
        showErrorModal: false,
      },
    })
  )
}
