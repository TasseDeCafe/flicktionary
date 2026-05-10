import { createFileRoute } from '@tanstack/react-router'
import { NewAdhocCardWizard } from '@/features/vocabulary/components/new-adhoc-card-wizard'

export const Route = createFileRoute('/_authenticated/_app/vocabulary/new-word')({
  component: NewAdhocCardWizard,
  staticData: { hideAppChrome: true },
})
