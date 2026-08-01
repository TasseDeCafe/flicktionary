import { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import {
  BookOpen,
  Brain,
  ChartColumn,
  CircleHelp,
  Clapperboard,
  Compass,
  Home,
  MoreHorizontal,
  Plus,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { MainActionOverlay } from './main-action-overlay'

type NavItem = {
  to: '/dashboard' | '/sessions' | '/explore' | '/practice' | '/vocabulary' | '/stats' | '/more'
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
        isActive
          ? 'bg-yellow-100 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-300'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
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
    { to: '/dashboard', label: t`Dashboard`, icon: Home, matchPrefixes: ['/dashboard'] },
    { to: '/sessions', label: t`Sessions`, icon: Clapperboard, matchPrefixes: ['/sessions'] },
    { to: '/explore', label: t`Explore`, icon: Compass, matchPrefixes: ['/explore'] },
    { to: '/practice', label: t`Practice`, icon: Brain, matchPrefixes: ['/practice'] },
    { to: '/vocabulary', label: t`Vocabulary`, icon: BookOpen, matchPrefixes: ['/vocabulary'] },
    { to: '/stats', label: t`Stats`, icon: ChartColumn, matchPrefixes: ['/stats'] },
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
      <div className='border-t p-3'>
        <Link
          to='/user-guide'
          className='text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors'
        >
          <CircleHelp className='h-5 w-5' strokeWidth={2} />
          <span>{t`User guide`}</span>
        </Link>
      </div>
      <MainActionOverlay open={isActionOpen} onOpenChange={setIsActionOpen} />
    </div>
  )
}
