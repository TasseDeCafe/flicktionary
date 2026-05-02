import { createFileRoute } from '@tanstack/react-router'
import { TriageListView } from '@/features/review/components/triage-list-view'

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/review/')({
  component: TriageListView,
  staticData: { hideAppChrome: true },
})
