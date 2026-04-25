import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'

export const useSendVerificationEmail = (options?: {
  onSuccess?: () => void
  onError?: (error: Error) => void
  meta?: Record<string, unknown>
}) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.authentication.sendEmailVerification.mutationOptions({
      ...options,
      meta: {
        errorMessage: t`There was an error sending the verification email. Please try again.`,
        ...options?.meta,
      },
    })
  )
}
