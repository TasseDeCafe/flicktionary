import { useMutation, useMutationState } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { useLingui } from '@lingui/react/macro'
import { useTrackingStore } from '@/stores/tracking-store'

export const useCreateOrUpdateUser = () => {
  const { t } = useLingui()
  const setFromBackend = useTrackingStore((state) => state.setFromBackend)

  return useMutation(
    orpcQuery.user.putUser.mutationOptions({
      onSuccess: (response) => {
        const data = response.data
        const { referral, utmSource, utmMedium, utmCampaign, utmTerm, utmContent } = data

        setFromBackend({
          referral,
          utmSource,
          utmMedium,
          utmCampaign,
          utmTerm,
          utmContent,
        })
      },
      meta: {
        successMessage: t`User setup complete`,
        errorMessage: t`Error setting up user data`,
        showErrorModal: true,
      },
    })
  )
}

// Hook to check if user setup has completed (for use in components that need to wait)
export const useIsUserSetupComplete = () => {
  const mutations = useMutationState({
    filters: { mutationKey: orpcQuery.user.putUser.key(), status: 'success' },
    select: (mutation) => mutation.state.status,
  })

  return mutations.length > 0
}
