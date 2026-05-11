import { createFileRoute } from '@tanstack/react-router'
import { SessionsListView } from '@/features/sessions/components/sessions-list-view'

export const Route = createFileRoute('/_authenticated/_app/sessions/')({
  component: SessionsListView,
})
