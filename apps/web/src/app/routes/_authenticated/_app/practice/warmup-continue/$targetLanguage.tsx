import { createFileRoute } from '@tanstack/react-router'
import { WarmupContinueView } from '@/features/practice/components/warmup-continue-view'

// Language-scoped warm-up continuation (no studySessionId) — resumes onboarding
// terms already parked across any session. Modal screen, like Strengthen.
export const Route = createFileRoute('/_authenticated/_app/practice/warmup-continue/$targetLanguage')({
  component: WarmupContinueView,
  staticData: { hideAppChrome: true },
})
