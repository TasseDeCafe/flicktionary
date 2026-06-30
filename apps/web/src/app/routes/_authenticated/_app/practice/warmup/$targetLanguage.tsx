import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { WarmupView } from '@/features/practice/components/warmup-view'

// `studySessionId` scopes the warm-up to one session's kept terms — the server
// re-validates ownership and language, so it is never trusted as-is.
const warmupSearchSchema = z.object({
  studySessionId: z.string().uuid(),
})

export const Route = createFileRoute('/_authenticated/_app/practice/warmup/$targetLanguage')({
  validateSearch: warmupSearchSchema,
  component: WarmupView,
  staticData: { hideAppChrome: true },
})
