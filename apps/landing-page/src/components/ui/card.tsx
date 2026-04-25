import { ReactNode } from 'react'
import { cn } from '@template-app/core/utils/tailwind-utils'

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => {
  return (
    <div className={cn('flex w-full max-w-md flex-col rounded-3xl bg-white p-8 shadow-lg', className)}>{children}</div>
  )
}
