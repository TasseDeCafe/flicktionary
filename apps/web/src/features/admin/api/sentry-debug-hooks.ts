import { useMutation } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { useLingui } from '@lingui/react/macro'

export const useTriggerSentryMessageMutation = () => {
  const { t } = useLingui()

  return useMutation(
    orpcQuery.sentryDebug.triggerSentryMessage.mutationOptions({
      meta: {
        errorMessage: t`Failed to trigger Sentry message`,
      },
    })
  )
}
