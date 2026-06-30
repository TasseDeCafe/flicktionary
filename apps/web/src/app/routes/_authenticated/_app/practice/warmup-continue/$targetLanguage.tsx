import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { WarmupContinueView } from '@/features/practice/components/warmup-continue-view'

// `pool` selects which onboarding-parked population to resume: recognition (the
// default) or production. Both have their own "N terms warming up — continue"
// affordance on the language screen.
const warmupContinueSearchSchema = z.object({
  pool: z.enum(['recognition', 'production']).catch('recognition'),
})

// Language-scoped warm-up continuation (no studySessionId) — resumes onboarding
// terms already parked across any session. Modal screen, like Strengthen.
export const Route = createFileRoute('/_authenticated/_app/practice/warmup-continue/$targetLanguage')({
  validateSearch: warmupContinueSearchSchema,
  component: WarmupContinueView,
  staticData: { hideAppChrome: true },
})
