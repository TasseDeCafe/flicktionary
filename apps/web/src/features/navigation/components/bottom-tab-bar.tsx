import { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { BookOpen, Brain, Home, MoreHorizontal, Plus, type LucideIcon } from 'lucide-react'
import { MainActionOverlay } from './main-action-overlay'

type TabConfig = {
  to: '/dashboard' | '/practice' | '/vocabulary' | '/more'
  label: string
  icon: LucideIcon
  matchPrefixes: string[]
}

const TabLink = ({ tab, isActive }: { tab: TabConfig; isActive: boolean }) => {
  const Icon = tab.icon
  return (
    <Link
      to={tab.to}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
        isActive ? 'text-yellow-900 dark:text-yellow-400' : 'text-muted-foreground'
      )}
    >
      <Icon className='h-5 w-5' strokeWidth={isActive ? 2.5 : 2} />
      <span>{tab.label}</span>
    </Link>
  )
}

export const BottomTabBar = () => {
  const { t } = useLingui()
  const location = useLocation()
  const [isActionOpen, setIsActionOpen] = useState(false)

  // Destinations without a tab of their own keep their parent tab highlighted
  // (the iOS More-tab convention): Sessions is Dashboard's drill-in, Stats is
  // reached from More. The views render a MobileBackLink to the same parent.
  const tabs: TabConfig[] = [
    { to: '/dashboard', label: t`Dashboard`, icon: Home, matchPrefixes: ['/dashboard', '/sessions', '/explore'] },
    { to: '/practice', label: t`Practice`, icon: Brain, matchPrefixes: ['/practice'] },
    { to: '/vocabulary', label: t`Vocabulary`, icon: BookOpen, matchPrefixes: ['/vocabulary'] },
    { to: '/more', label: t`More`, icon: MoreHorizontal, matchPrefixes: ['/more', '/stats'] },
  ]

  const isTabActive = (tab: TabConfig) =>
    tab.matchPrefixes.some((prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`))

  return (
    <>
      <nav
        aria-label={t`Primary`}
        className='bg-background fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t pb-[env(safe-area-inset-bottom)] md:hidden'
      >
        <TabLink tab={tabs[0]} isActive={isTabActive(tabs[0])} />
        <TabLink tab={tabs[1]} isActive={isTabActive(tabs[1])} />
        <div className='relative flex flex-1 items-center justify-center'>
          <button
            type='button'
            onClick={() => setIsActionOpen(true)}
            aria-label={t`New`}
            className='flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-yellow-400 text-yellow-950 shadow-lg transition-colors hover:bg-yellow-500 active:bg-yellow-500'
          >
            <Plus className='h-6 w-6' strokeWidth={2.5} />
          </button>
        </div>
        <TabLink tab={tabs[2]} isActive={isTabActive(tabs[2])} />
        <TabLink tab={tabs[3]} isActive={isTabActive(tabs[3])} />
      </nav>
      <MainActionOverlay open={isActionOpen} onOpenChange={setIsActionOpen} />
    </>
  )
}
