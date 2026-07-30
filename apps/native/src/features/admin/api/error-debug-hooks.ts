import { useMutation } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { useLingui } from '@lingui/react/macro'

export const useTriggerErrorMessageMutation = () => {
  const { t } = useLingui()

  return useMutation(
    orpcQuery.errorDebug.triggerErrorMessage.mutationOptions({
      meta: {
        errorMessage: t`Failed to trigger the backend test error`,
      },
    })
  )
}
