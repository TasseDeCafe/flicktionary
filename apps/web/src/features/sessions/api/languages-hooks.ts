import { useMutation } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'

// Language detection is an advisory hint — never block the UX. Errors stay
// silent so a flaky backend or rate limit doesn't pop a modal mid-typing.
export const useDetectLanguage = () =>
  useMutation(
    orpcQuery.languages.detect.mutationOptions({
      meta: { showErrorModal: false },
    })
  )
