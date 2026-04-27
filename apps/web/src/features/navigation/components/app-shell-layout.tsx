import { useState } from 'react'
import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { useLingui } from '@lingui/react/macro'
import { Clapperboard, CircleUserRound, Menu, Settings, type LucideIcon } from 'lucide-react'
import { ContactUsButton } from '@/features/contact/components/contact-us-button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Button } from '@/components/ui/button'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
}

const NavLink = ({
  to,
  label,
  icon: Icon,
  isActive,
  onClick,
}: NavItem & { isActive: boolean; onClick?: () => void }) => (
  <Link
    to={to}
    onClick={onClick}
    className={cn(
      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
      isActive ? 'bg-yellow-100 text-yellow-900' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    )}
  >
    <Icon className='h-5 w-5' strokeWidth={2} />
    <span>{label}</span>
  </Link>
)

const useNavItems = (): NavItem[] => {
  const { t } = useLingui()
  return [
    { to: '/sessions', label: t`Sessions`, icon: Clapperboard },
    { to: '/settings', label: t`Settings`, icon: Settings },
    { to: '/profile', label: t`Profile`, icon: CircleUserRound },
  ]
}

const SidebarNav = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { t } = useLingui()
  const location = useLocation()
  const navItems = useNavItems()

  return (
    <div className='flex h-full flex-col'>
      <div className='flex h-14 shrink-0 items-center border-b px-4'>
        <span className='text-lg font-semibold tracking-tight'>{t`Flicktionary`}</span>
      </div>
      <nav className='flex-1 space-y-1 overflow-y-auto p-3'>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            {...item}
            isActive={location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)}
            onClick={onNavigate}
          />
        ))}
      </nav>
      <div className='border-t p-3'>
        <ContactUsButton />
      </div>
    </div>
  )
}

export const AppShellLayout = () => {
  const { t } = useLingui()
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const closeMobile = () => setIsMobileOpen(false)

  return (
    <div className='flex h-dvh overflow-hidden'>
      {/* Desktop sidebar */}
      <aside className='hidden w-64 shrink-0 border-r bg-white md:block'>
        <SidebarNav />
      </aside>

      {/* Mobile drawer */}
      <Drawer direction='left' open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <DrawerContent className='h-full w-64 rounded-none'>
          <VisuallyHidden>
            <DrawerTitle>{t`Navigation`}</DrawerTitle>
          </VisuallyHidden>
          <SidebarNav onNavigate={closeMobile} />
        </DrawerContent>
      </Drawer>

      {/* Main column */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        <header className='flex h-14 shrink-0 items-center justify-between border-b bg-white px-4 md:hidden'>
          <Button variant='ghost' size='icon' onClick={() => setIsMobileOpen(true)} aria-label={t`Open menu`}>
            <Menu className='h-5 w-5' />
          </Button>
          <span className='text-lg font-semibold'>{t`Flicktionary`}</span>
          <div className='w-9' />
        </header>
        <main className='flex-1 overflow-y-auto'>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
