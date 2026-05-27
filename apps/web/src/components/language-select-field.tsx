import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Pencil } from 'lucide-react'
import { findSupportedLanguage, type SupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'
import { LanguageOptionList } from '@/components/language-option-list'
import {
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
  ResponsiveOverlay,
} from '@/components/ui/responsive-overlay'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

type Props = {
  label: ReactNode
  value: string | null
  onChange: (code: SupportedLanguageCode) => void
  placeholder?: ReactNode
  // Pinned at the top of the picker list (e.g. user's last target language).
  pinnedCode?: string | null
  disabled?: boolean
  // Optional helper rendered directly below the field (e.g. the language-detection hint).
  helper?: ReactNode
}

export const LanguageSelectField = ({ label, value, onChange, placeholder, pinnedCode, disabled, helper }: Props) => {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)

  const selected = value ? findSupportedLanguage(value) : undefined
  const valueLine = selected
    ? `${selected.nativeName} · ${selected.code.toUpperCase()}`
    : (placeholder ?? t`Pick a language`)

  return (
    <div className='flex flex-col gap-2'>
      <button
        type='button'
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          'bg-card flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors',
          'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'border-border hover:border-foreground/40 hover:bg-accent/40 active:bg-accent/60'
        )}
      >
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <div className='truncate text-base font-medium'>{selected ? selected.name : (placeholder ?? label)}</div>
          <div className='text-muted-foreground truncate text-sm'>{selected ? valueLine : label}</div>
        </div>
        <div className='bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full'>
          <Pencil className='h-4 w-4' />
        </div>
      </button>
      {helper}

      <ResponsiveOverlay open={open} onOpenChange={setOpen}>
        <OverlayContent
          className={cn(
            // Mobile (Drawer): fixed height so the sheet doesn't shrink as the
            // search filters the list and lets the on-screen keyboard cover it.
            'h-[85svh]',
            // Desktop (Dialog): cap at 80vh and let the dialog itself scroll.
            'sm:h-auto sm:max-h-[80vh] sm:max-w-md sm:overflow-y-auto'
          )}
        >
          <OverlayHeader>
            <OverlayTitle>{label}</OverlayTitle>
            <OverlayDescription className='sr-only'>{t`Pick a language from the list.`}</OverlayDescription>
          </OverlayHeader>
          <LanguageOptionList
            value={value}
            pinnedCode={pinnedCode ?? value}
            onChange={(code) => {
              onChange(code)
              setOpen(false)
            }}
          />
        </OverlayContent>
      </ResponsiveOverlay>
    </div>
  )
}
