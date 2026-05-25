import { X } from 'lucide-react'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Input } from '@/components/ui/input'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

// Search field with a clear ("×") affordance that appears once there's input.
// The native WebKit search-cancel button is hidden so we don't render two crosses.
export const SearchInput = ({ value, onChange, placeholder, className }: Props) => {
  const { t } = useLingui()
  return (
    <div className={cn('relative', className)}>
      <Input
        type='search'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className='w-full pr-9 [&::-webkit-search-cancel-button]:appearance-none'
      />
      {value.length > 0 && (
        <button
          type='button'
          onClick={() => onChange('')}
          aria-label={t`Clear search`}
          className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5'
        >
          <X className='h-4 w-4' />
        </button>
      )}
    </div>
  )
}
