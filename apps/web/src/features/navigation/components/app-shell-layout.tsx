import { Navigate, Outlet, useMatches } from '@tanstack/react-router'
import { useIsModalRoute } from '../hooks/use-is-modal-route'
import { SidebarNav } from './sidebar-nav'
import { BottomTabBar } from './bottom-tab-bar'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { FullViewLoader } from '@flicktionary/ui/components/full-view-loader'

const ONBOARDING_PATH = '/onboarding'
const APP_ROUTE_ID = '/_authenticated/_app'
const ONBOARDING_ROUTE_ID = '/_authenticated/_app/onboarding'
const MORE_ROUTE_ID_PREFIX = '/_authenticated/_app/more'

export const AppShellLayout = () => {
  const isModal = useIsModalRoute()
  const { data: prefs, isLoading } = useGetUserPrefs()
  // Key the gate off the committed matched routes, NOT location.pathname: during a
  // navigation OUT of the _app subtree (e.g. /more -> /profile/danger-zone) this
  // still-mounted layout would briefly observe the foreign pathname and bounce to
  // onboarding before the router could swap _app out. The matches stay consistent
  // with the route tree this layout actually owns.
  const matches = useMatches()
  const isAppRoute = matches.some((match) => match.routeId === APP_ROUTE_ID)
  const isOnboardingRoute = matches.some((match) => match.routeId === ONBOARDING_ROUTE_ID)
  // The More subtree is the escape hatch a not-yet-onboarded user can reach from
  // the onboarding X: sign out, delete the account, or re-enter onboarding.
  const isMoreRoute = matches.some((match) => match.routeId.startsWith(MORE_ROUTE_ID_PREFIX))

  // Onboarding gate. Wait for prefs to load (avoids redirect-loop on a stale cache);
  // route everyone with is_onboarded=false to /onboarding, including users landing
  // straight on a deep link. The More subtree stays reachable so they can leave or
  // manage their account; every other _app surface bounces back so the mandatory
  // values can't be skipped. Routes outside _app (Danger zone, pricing, …) are not
  // this layout's concern and are never gated. Auto-seeded test accounts skip this.
  if (isLoading) return <FullViewLoader />
  if (prefs && !prefs.isOnboarded && isAppRoute && !isOnboardingRoute && !isMoreRoute) {
    return <Navigate to={ONBOARDING_PATH} />
  }

  // Modal routes (subtitles, triage, focus, processing, new-session, onboarding) own
  // the full viewport: no sidebar, no tab bar. They render their own ModalScreen
  // header. Mirrors React Navigation's `presentation: 'modal'` pattern.
  if (isModal) return <Outlet />

  return (
    <div className='flex h-dvh overflow-hidden'>
      <aside className='bg-background hidden w-64 shrink-0 border-r md:block'>
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
