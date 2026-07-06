import { useMutation } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { orpcQuery } from '@/lib/transport/orpc-client'

const isRetryableClaimError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { status?: number }).status === 409

export const useClaimTelegramPairMutation = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.telegramPair.claim.mutationOptions({
      // 409 means the public.users row is still being created by
      // UserSetupGate right after signup; the claim rolled back and the same
      // nonce stays valid, so a short retry loop resolves the race.
      retry: (failureCount, error) => failureCount < 5 && isRetryableClaimError(error),
      retryDelay: 700,
      meta: {
        errorMessage: t`Failed to connect Telegram`,
        // The page renders its own error card with recovery instructions.
        showErrorToast: false,
      },
    })
  )
}

export const useCompleteTelegramPendingMutation = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.telegramPair.completePending.mutationOptions({
      // Fire-and-forget kick for the stashed import; the bot replies in
      // Telegram either way, so a failure here is invisible on this page.
      meta: {
        errorMessage: t`Failed to resume your Telegram import`,
        showErrorToast: false,
      },
    })
  )
}
