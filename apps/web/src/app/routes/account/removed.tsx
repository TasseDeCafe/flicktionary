import { createFileRoute } from '@tanstack/react-router'
import { AccountRemovedView } from '@/features/auth/components/account-removed-view.tsx'

export const Route = createFileRoute('/account/removed')({
  component: AccountRemovedView,
})
