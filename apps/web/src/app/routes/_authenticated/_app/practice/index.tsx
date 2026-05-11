import { createFileRoute } from '@tanstack/react-router'
import { PracticeLandingView } from '@/features/practice/components/practice-landing-view'

export const Route = createFileRoute('/_authenticated/_app/practice/')({
  component: PracticeLandingView,
})
