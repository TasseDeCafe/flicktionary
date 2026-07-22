import { cn } from '@flicktionary/core/utils/tailwind-utils'

// The app has exactly two page-column widths: `wide` for the data/browse tabs
// (Dashboard, Sessions, Stats) and `narrow` for single-column funnel and
// settings tabs (Practice, Vocabulary, More). Top-level tab views pick a
// variant here instead of hand-rolling max-w-* so the tabs stay consistent.
const WIDTHS = {
  wide: 'max-w-5xl',
  narrow: 'max-w-2xl',
} as const

type Props = {
  width: keyof typeof WIDTHS
  className?: string
  children: React.ReactNode
}

export const PageContainer = ({ width, className, children }: Props) => (
  <div className={cn('mx-auto w-full px-4 py-6', WIDTHS[width], className)}>{children}</div>
)
