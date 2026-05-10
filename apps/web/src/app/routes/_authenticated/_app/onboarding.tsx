import { createFileRoute } from '@tanstack/react-router'
import { OnboardingView } from '@/features/onboarding/components/onboarding-view'

export const Route = createFileRoute('/_authenticated/_app/onboarding')({
  component: OnboardingView,
  staticData: { hideAppChrome: true },
})
