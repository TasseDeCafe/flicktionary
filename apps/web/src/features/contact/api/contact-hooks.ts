import { useMutation } from '@tanstack/react-query'
import { OrpcMutationOverrides } from '@/types/hook-types'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { useLingui } from '@lingui/react/macro'

export const useSendContactEmail = (
  options?: OrpcMutationOverrides<typeof orpcQuery.contactEmail.sendContactEmail>
) => {
  const { t } = useLingui()

  return useMutation(
    orpcQuery.contactEmail.sendContactEmail.mutationOptions({
      ...options,
      meta: {
        successMessage: t`Thank you for your feedback!`,
        errorMessage: t`Failed to send feedback. Please try again.`,
        ...options?.meta,
      },
    })
  )
}
