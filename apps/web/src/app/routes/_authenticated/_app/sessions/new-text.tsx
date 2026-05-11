import { createFileRoute } from '@tanstack/react-router'
import { NewTextSessionWizard } from '@/features/sessions/components/new-text-session-wizard'

export const Route = createFileRoute('/_authenticated/_app/sessions/new-text')({
  component: NewTextSessionWizard,
  staticData: { hideAppChrome: true },
})
