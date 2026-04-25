import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { cn } from '@template-app/core/utils/tailwind-utils'
import { ContactUsButton } from '@/features/contact/components/contact-us-button'
import { Home, Dumbbell, CircleUserRound, type LucideIcon } from 'lucide-react'
import { useLingui } from '@lingui/react/macro'
import { Route as homeRoute } from '@/app/routes/_authenticated/_tabs/home'
import { Route as dashboardRoute } from '@/app/routes/_authenticated/_tabs/dashboard'
import { Route as profileRoute } from '@/app/routes/_authenticated/_tabs/profile'

type TabConfig = {
  to: string
  label: string
  icon: LucideIcon
}

const TabLink = ({
  to,
  label,
  icon: Icon,
  isActive,
}: {
  to: string
  label: string
  icon: LucideIcon
  isActive: boolean
}) => (
  <Link
    to={to}
    className={cn(
      'flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors',
      isActive ? 'text-yellow-500' : 'text-gray-500 hover:text-gray-700'
    )}
  >
    <Icon className='h-6 w-6' strokeWidth={2} />
    <span className='text-xs font-medium'>{label}</span>
  </Link>
)

export const TabsLayout = () => {
  const { t } = useLingui()
  const location = useLocation()

  const tabs: TabConfig[] = [
    { to: homeRoute.to, label: t`Home`, icon: Home },
    { to: dashboardRoute.to, label: t`Dashboard`, icon: Dumbbell },
    { to: profileRoute.to, label: t`Profile`, icon: CircleUserRound },
  ]

  return (
    <div className='flex h-dvh flex-col overflow-hidden'>
      {/* Header */}
      <header className='bg-background flex h-14 shrink-0 items-center justify-end border-b px-4'>
        <ContactUsButton />
      </header>

      {/* Main content */}
      <main className='flex-1 overflow-y-auto overscroll-contain pb-20'>
        <Outlet />
      </main>

      {/* Bottom tabs */}
      <nav className='fixed right-0 bottom-0 left-0 z-10 rounded-t-3xl bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]'>
        <div className='flex h-16 items-center justify-around'>
          {tabs.map((tab) => (
            <TabLink
              key={tab.to}
              to={tab.to}
              label={tab.label}
              icon={tab.icon}
              isActive={location.pathname.includes(tab.to)}
            />
          ))}
        </div>
      </nav>
    </div>
  )
}
