import { createFileRoute } from '@tanstack/react-router'
import { AccountPage } from '@/features/more/components/account-page'

export const Route = createFileRoute('/_authenticated/_app/more/account')({
  component: AccountPage,
  staticData: { hideAppChrome: true },
})
