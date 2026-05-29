import { useMutation } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'

export const useMintExtensionSessionMutation = () =>
  useMutation(
    orpcQuery.extensionAuth.mintSession.mutationOptions({
      meta: { errorMessage: 'Failed to mint extension session' },
    })
  )
