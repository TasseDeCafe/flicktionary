import { createFileRoute } from '@tanstack/react-router'
import { NewSessionWizard } from '@/features/sessions/components/new-session-wizard'

export const Route = createFileRoute('/_authenticated/_app/sessions/new')({
  component: NewSessionWizard,
})
