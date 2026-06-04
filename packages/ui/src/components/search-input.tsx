import { SearchIcon, X } from 'lucide-react'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Input } from './input'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  autoFocus?: boolean
}

// Shared search field: a leading magnifying glass plus a clear ("×") affordance
// that appears once there's input. The native WebKit search-cancel button is
// hidden so we don't render two crosses.
export const SearchInput = ({ value, onChange, placeholder, className, disabled, autoFocus }: Props) => {
  const { t } = useLingui()
  return (
    <div className={cn('relative', className)}>
      <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
      <Input
        type='search'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className='w-full pr-10 pl-9 sm:pr-9 [&::-webkit-search-cancel-button]:appearance-none'
      />
      {value.length > 0 && (
        <button
          type='button'
          onClick={() => onChange('')}
          aria-label={t`Clear search`}
          className='text-muted-foreground hover:text-foreground absolute top-1/2 right-1 flex -translate-y-1/2 items-center justify-center rounded-sm p-2 sm:right-2 sm:p-0.5'
        >
          <X className='h-5 w-5 sm:h-4 sm:w-4' />
        </button>
      )}
    </div>
  )
}
