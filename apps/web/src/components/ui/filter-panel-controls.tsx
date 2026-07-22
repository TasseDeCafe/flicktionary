import { cn } from '@flicktionary/core/utils/tailwind-utils'

// Shared atoms for the "Sort & filter" panels (Vocabulary, Sessions): a
// segmented pill row for short option sets, a wrapping pill grid for wide
// ones, and the section heading that labels them.

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (next: T) => void
}) => (
  <div className='bg-muted flex gap-1 rounded-full p-1'>
    {options.map((opt) => (
      <button
        key={opt.value}
        type='button'
        onClick={() => onChange(opt.value)}
        className={cn(
          'flex-1 rounded-full px-3 py-1 text-xs font-medium transition-colors',
          opt.value === value
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {opt.label}
      </button>
    ))}
  </div>
)

export const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h3 className='text-muted-foreground text-xs font-semibold tracking-wider uppercase'>{children}</h3>
)

// Wrapping single-select pill grid for option sets too wide for the segmented
// row. Same chip language as the language switcher, sized up for comfortable
// tapping.
export const PillGrid = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (next: T) => void
}) => (
  <div className='flex flex-wrap gap-2'>
    {options.map((opt) => (
      <button
        key={opt.value}
        type='button'
        onClick={() => onChange(opt.value)}
        className={cn(
          'rounded-full border px-3.5 py-2 text-sm font-medium transition-colors',
          opt.value === value
            ? 'border-yellow-500 bg-yellow-100 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-300'
            : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent'
        )}
      >
        {opt.label}
      </button>
    ))}
  </div>
)
