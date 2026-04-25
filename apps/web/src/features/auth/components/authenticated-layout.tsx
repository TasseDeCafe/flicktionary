import { Outlet } from '@tanstack/react-router'
import { getIsSignedIn, useAuthStore } from '@/stores/auth-store'
import { useIsUserSetupComplete } from '@/features/user/api/user-hooks'
import { FullViewLoader } from '@/components/ui/full-view-loader'

export const AuthenticatedLayout = () => {
  const isSignedIn = useAuthStore(getIsSignedIn)
  const isLoading = useAuthStore((state) => state.isLoading)
  const isUserSetupComplete = useIsUserSetupComplete()

  if (isLoading || !isSignedIn || !isUserSetupComplete) {
    return <FullViewLoader />
  }

  return <Outlet />
}
