import { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Brain, Clapperboard, MoreHorizontal, Plus, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MainActionOverlay } from './main-action-overlay'

type NavItem = {
  to: '/sessions' | '/practice' | '/more'
  label: string
  icon: LucideIcon
  matchPrefixes: string[]
}

const NavLink = ({ item, isActive }: { item: NavItem; isActive: boolean }) => {
  const Icon = item.icon
  return (
    <Link
      to={item.to}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive ? 'bg-yellow-100 text-yellow-900' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      )}
    >
      <Icon className='h-5 w-5' strokeWidth={2} />
      <span>{item.label}</span>
    </Link>
  )
}

export const SidebarNav = () => {
  const { t } = useLingui()
  const location = useLocation()
  const [isActionOpen, setIsActionOpen] = useState(false)

  const items: NavItem[] = [
    { to: '/sessions', label: t`Sessions`, icon: Clapperboard, matchPrefixes: ['/sessions'] },
    { to: '/practice', label: t`Practice`, icon: Brain, matchPrefixes: ['/practice'] },
    { to: '/more', label: t`More`, icon: MoreHorizontal, matchPrefixes: ['/more'] },
  ]

  const isItemActive = (item: NavItem) =>
    item.matchPrefixes.some((prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`))

  return (
    <div className='flex h-full flex-col'>
      <div className='flex h-14 shrink-0 items-center border-b px-4'>
        <span className='text-lg font-semibold tracking-tight'>{t`Flicktionary`}</span>
      </div>
      <div className='border-b p-3'>
        <Button onClick={() => setIsActionOpen(true)} size='lg' className='w-full justify-start'>
          <Plus className='h-5 w-5' />
          {t`New`}
        </Button>
      </div>
      <nav className='flex-1 space-y-1 overflow-y-auto p-3'>
        {items.map((item) => (
          <NavLink key={item.to} item={item} isActive={isItemActive(item)} />
        ))}
      </nav>
      <MainActionOverlay open={isActionOpen} onOpenChange={setIsActionOpen} />
    </div>
  )
}
