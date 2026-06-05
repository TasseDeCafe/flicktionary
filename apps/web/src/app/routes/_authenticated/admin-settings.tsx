import { createFileRoute, redirect } from '@tanstack/react-router'
import { AdminSettingsView } from '@/features/admin/components/admin-settings-view.tsx'
import { getUserEmail, useAuthStore } from '@/stores/auth-store'
import { checkIsTestUser } from '@/utils/test-users-utils'

export const Route = createFileRoute('/_authenticated/admin-settings')({
  // Admin tooling is test-user only (VITE_HASHED_EMAILS_OF_TEST_USERS); the
  // parent _authenticated guard already guarantees a session here.
  beforeLoad: () => {
    if (!checkIsTestUser(getUserEmail(useAuthStore.getState()))) {
      throw redirect({ to: '/more' })
    }
  },
  component: AdminSettingsView,
})
