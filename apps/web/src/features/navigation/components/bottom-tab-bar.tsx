import { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Clapperboard, MoreHorizontal, Plus, type LucideIcon } from 'lucide-react'
import { MainActionOverlay } from './main-action-overlay'

type TabConfig = {
  to: '/sessions' | '/more'
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
        isActive ? 'text-yellow-900' : 'text-gray-500'
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

  const tabs: TabConfig[] = [
    { to: '/sessions', label: t`Sessions`, icon: Clapperboard, matchPrefixes: ['/sessions'] },
    { to: '/more', label: t`More`, icon: MoreHorizontal, matchPrefixes: ['/more'] },
  ]

  const isTabActive = (tab: TabConfig) =>
    tab.matchPrefixes.some((prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`))

  return (
    <>
      <nav
        aria-label={t`Primary`}
        className='fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t bg-white pb-[env(safe-area-inset-bottom)] md:hidden'
      >
        <TabLink tab={tabs[0]} isActive={isTabActive(tabs[0])} />
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
        <TabLink tab={tabs[1]} isActive={isTabActive(tabs[1])} />
      </nav>
      <MainActionOverlay open={isActionOpen} onOpenChange={setIsActionOpen} />
    </>
  )
}
