import { Fragment, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

const Skeleton = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot='skeleton' className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
)

type SkeletonListProps = {
  count: number
  className?: string
  // Render a composite placeholder per item (e.g. a row skeleton). Omit to
  // repeat a plain `Skeleton` bar styled by `className` — the common case.
  renderItem?: (index: number) => ReactNode
}

// Repeats N keyed placeholders. Keeps the `Array.from(...).map()` + key
// boilerplate out of every loading view. For a list of simple bars pass only
// `count`/`className`; for a list of real rows pass a `renderItem` returning
// the co-located `*Skeleton` for that view.
const SkeletonList = ({ count, className, renderItem }: SkeletonListProps) => (
  <>
    {Array.from({ length: count }, (_, i) =>
      renderItem ? <Fragment key={i}>{renderItem(i)}</Fragment> : <Skeleton key={i} className={className} />
    )}
  </>
)

export { Skeleton, SkeletonList }
