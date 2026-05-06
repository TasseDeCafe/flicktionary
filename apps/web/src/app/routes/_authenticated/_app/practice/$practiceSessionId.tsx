import { createFileRoute } from '@tanstack/react-router'
import { PracticeSessionView } from '@/features/practice/components/practice-session-view'

export const Route = createFileRoute('/_authenticated/_app/practice/$practiceSessionId')({
  component: PracticeSessionView,
  staticData: { hideAppChrome: true },
})
