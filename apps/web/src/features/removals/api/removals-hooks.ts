import { useMutation } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { Route as accountRemovedRoute } from '@/app/routes/account/removed'
import { useLingui } from '@lingui/react/macro'

export const useDeleteAccount = () => {
  const { t } = useLingui()

  return useMutation(
    orpcQuery.removals.postRemoval.mutationOptions({
      onSuccess: () => {
        window.localStorage.clear()
        window.location.replace(window.location.origin + accountRemovedRoute.to)
      },
      meta: {
        successMessage: t`Your account has been deleted successfully.`,
        errorMessage: t`An error occurred. Please try again.`,
      },
    })
  )
}
