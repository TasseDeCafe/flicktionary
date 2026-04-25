import { useMutation } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { OrpcMutationOverrides } from '@/types/hook-types'
import { useLingui } from '@lingui/react/macro'

export const useDeleteAccount = (options?: OrpcMutationOverrides<typeof orpcQuery.removals.postRemoval>) => {
  const { t } = useLingui()

  return useMutation(
    orpcQuery.removals.postRemoval.mutationOptions({
      ...options,
      meta: {
        successMessage: t`Your account has been deleted successfully.`,
        errorMessage: t`An error occurred. Please try again.`,
        invalidates: [],
        ...options?.meta,
      },
    })
  )
}
