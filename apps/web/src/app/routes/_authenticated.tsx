import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/features/auth/components/authenticated-layout'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ location }) => {
    const { session, isSigningOut } = useAuthStore.getState()
    if (!session?.access_token) {
      throw redirect({
        to: '/login',
        search: isSigningOut ? undefined : { redirect: location.pathname },
      })
    }
  },
  component: AuthenticatedLayout,
})
