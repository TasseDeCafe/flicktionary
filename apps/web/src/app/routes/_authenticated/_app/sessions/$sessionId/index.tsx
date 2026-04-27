import { createFileRoute } from '@tanstack/react-router'
import { SessionView } from '@/features/sessions/components/session-view'

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/')({
  component: SessionView,
})
