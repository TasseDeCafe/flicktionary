import { useMemo, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react'
import {
  SUPPORTED_LANGUAGES,
  type SupportedLanguageCode,
  findSupportedLanguage,
} from '@flicktionary/core/constants/supported-languages'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type Props = {
  value: string | null
  onChange: (code: SupportedLanguageCode) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  excludeCodes?: readonly string[]
  id?: string
}

export const LanguagePicker = ({ value, onChange, placeholder, disabled, className, excludeCodes, id }: Props) => {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = value ? findSupportedLanguage(value) : undefined

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return SUPPORTED_LANGUAGES.filter((lang) => {
      if (excludeCodes?.includes(lang.code)) return false
      if (!q) return true
      return (
        lang.code.toLowerCase().includes(q) ||
        lang.name.toLowerCase().includes(q) ||
        lang.nativeName.toLowerCase().includes(q)
      )
    })
  }, [query, excludeCodes])

  const handleSelect = (code: SupportedLanguageCode) => {
    onChange(code)
    setOpen(false)
    setQuery('')
  }

  const triggerLabel = selected
    ? `${selected.name} (${selected.code.toUpperCase()})`
    : value
      ? value.toUpperCase()
      : (placeholder ?? t`Select a language`)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setQuery('')
          // Focus the search after open animation kicks in.
          requestAnimationFrame(() => inputRef.current?.focus())
        }
      }}
    >
      <PopoverTrigger
        id={id}
        type='button'
        disabled={disabled}
        className={cn(
          'border-input bg-background hover:bg-accent hover:text-accent-foreground flex h-9 w-full items-center justify-between rounded-md border px-3 py-1 text-sm shadow-xs transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          !selected && !value && 'text-muted-foreground',
          className
        )}
      >
        <span className='truncate'>{triggerLabel}</span>
        <ChevronDownIcon className='text-muted-foreground ml-2 h-4 w-4 shrink-0' />
      </PopoverTrigger>
      <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-0' align='start'>
        <div className='flex items-center border-b px-3'>
          <SearchIcon className='text-muted-foreground mr-2 h-4 w-4 shrink-0' />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t`Search languages…`}
            className='placeholder:text-muted-foreground flex h-9 w-full rounded-md bg-transparent py-2 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) {
                handleSelect(filtered[0].code)
              }
            }}
          />
        </div>
        <ul className='max-h-72 overflow-y-auto p-1' role='listbox'>
          {filtered.length === 0 && (
            <li className='text-muted-foreground px-3 py-6 text-center text-sm'>{t`No languages found.`}</li>
          )}
          {filtered.map((lang) => {
            const isSelected = lang.code === value
            return (
              <li key={lang.code} role='option' aria-selected={isSelected}>
                <button
                  type='button'
                  onClick={() => handleSelect(lang.code)}
                  className={cn(
                    'hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none',
                    'focus-visible:bg-accent focus-visible:text-accent-foreground'
                  )}
                >
                  <span className='flex min-w-0 flex-col'>
                    <span className='truncate font-medium'>{lang.name}</span>
                    <span className='text-muted-foreground truncate text-xs'>
                      {lang.nativeName} · {lang.code.toUpperCase()}
                    </span>
                  </span>
                  {isSelected && <CheckIcon className='h-4 w-4 shrink-0' />}
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
