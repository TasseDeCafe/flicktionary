import type { ComponentProps } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

const Skeleton = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot='skeleton' className={cn('animate-pulse rounded-md bg-gray-200', className)} {...props} />
)

export { Skeleton }
