import type { ReactNode } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

type Props = {
  collapsed: boolean
  children: ReactNode
  className?: string
}

// Animates its content's height to zero and back without knowing that height
// (a 0fr ↔ 1fr grid row). Collapsed content is `inert`, so its controls can't
// be tabbed into or read out while offscreen.
export const VerticalCollapse = ({ collapsed, children, className }: Props) => (
  <div
    inert={collapsed}
    className={cn(
      'grid shrink-0 transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
      collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
      className
    )}
  >
    <div className='min-h-0 overflow-hidden'>{children}</div>
  </div>
)
