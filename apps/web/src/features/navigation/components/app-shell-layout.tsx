import { Navigate, Outlet, useLocation } from '@tanstack/react-router'
import { useIsModalRoute } from '../hooks/use-is-modal-route'
import { SidebarNav } from './sidebar-nav'
import { BottomTabBar } from './bottom-tab-bar'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { FullViewLoader } from '@/components/ui/full-view-loader'

const ONBOARDING_PATH = '/onboarding'

export const AppShellLayout = () => {
  const isModal = useIsModalRoute()
  const { data: prefs, isLoading } = useGetUserPrefs()
  const location = useLocation()
  const isOnboardingRoute = location.pathname === ONBOARDING_PATH

  // Onboarding gate. Wait for prefs to load (avoids redirect-loop on a stale cache);
  // route everyone with is_onboarded=false to /onboarding, including users landing
  // straight on a deep link. Auto-seeded test accounts skip this entirely.
  if (isLoading) return <FullViewLoader />
  if (prefs && !prefs.isOnboarded && !isOnboardingRoute) {
    return <Navigate to={ONBOARDING_PATH} />
  }

  // Modal routes (subtitles, triage, focus, processing, new-session, onboarding) own
  // the full viewport: no sidebar, no tab bar. They render their own ModalScreen
  // header. Mirrors React Navigation's `presentation: 'modal'` pattern.
  if (isModal) return <Outlet />

  return (
    <div className='flex h-dvh overflow-hidden'>
      <aside className='hidden w-64 shrink-0 border-r bg-white md:block'>
        <SidebarNav />
      </aside>
      <div className='flex flex-1 flex-col overflow-hidden'>
        <main className='flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0'>
          <Outlet />
        </main>
      </div>
      <BottomTabBar />
    </div>
  )
}
