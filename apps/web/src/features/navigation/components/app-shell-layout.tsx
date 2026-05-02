import { Outlet } from '@tanstack/react-router'
import { useIsModalRoute } from '../hooks/use-is-modal-route'
import { SidebarNav } from './sidebar-nav'
import { BottomTabBar } from './bottom-tab-bar'

export const AppShellLayout = () => {
  const isModal = useIsModalRoute()

  // Modal routes (subtitles, triage, focus, processing, new-session) own the full
  // viewport: no sidebar, no tab bar. They render their own ModalScreen header with
  // an X-close. Mirrors React Navigation's `presentation: 'modal'` pattern.
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
