import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { PillGrid, SectionLabel, Segmented } from '@/components/ui/filter-panel-controls'
import { getLocalizedCoverageLanguageName } from '@/features/coverage/utils/coverage-language-names'

export type SessionsSort = 'newest' | 'oldest'

// The Sessions list's sort + language filter. The source-type filter stays on
// the chip row outside this control. `lang` undefined = all languages.
export type SessionFilters = {
  sort: SessionsSort
  lang: string | undefined
}

type Props = {
  filters: SessionFilters
  // Distinct languages present in the user's session list.
  languages: string[]
  onChange: (next: SessionFilters) => void
}

// The shared panel body, rendered inside the desktop popover and the mobile
// sheet alike.
const FilterPanel = ({ filters, languages, onChange }: Props) => {
  const { t, i18n } = useLingui()
  // 'all' is the UI-only "no language filter" choice; it maps to `undefined`.
  const langValue = filters.lang ?? 'all'

  return (
    <div className='flex flex-col gap-5'>
      <section className='flex flex-col gap-1.5'>
        <SectionLabel>{t`Sort`}</SectionLabel>
        <Segmented<SessionsSort>
          value={filters.sort}
          onChange={(sort) => onChange({ ...filters, sort })}
          options={[
            { value: 'newest', label: t`Newest first` },
            { value: 'oldest', label: t`Oldest first` },
          ]}
        />
      </section>

      {languages.length > 1 && (
        <section className='flex flex-col gap-1.5'>
          <SectionLabel>{t`Language`}</SectionLabel>
          <PillGrid<string>
            value={langValue}
            onChange={(next) => onChange({ ...filters, lang: next === 'all' ? undefined : next })}
            options={[
              { value: 'all', label: t`All` },
              ...languages.map((language) => ({
                value: language,
                label: getLocalizedCoverageLanguageName(i18n, language),
              })),
            ]}
          />
        </section>
      )}

      {filters.lang !== undefined && (
        <button
          type='button'
          onClick={() => onChange({ ...filters, lang: undefined })}
          className='text-muted-foreground hover:text-foreground self-end text-xs font-medium underline-offset-2 hover:underline'
        >
          {t`Clear filters`}
        </button>
      )}
    </div>
  )
}

// Single "Sort & filter" control: a Radix popover on desktop, a bottom sheet on
// mobile. The trigger carries a dot when the language filter is active.
export const SessionsFilterControl = ({ filters, languages, onChange }: Props) => {
  const { t } = useLingui()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const hasActiveFilters = filters.lang !== undefined

  const trigger = (
    <Button variant='outline' size='icon' aria-label={t`Sort and filter`} className='relative shrink-0'>
      <SlidersHorizontal className='h-5 w-5' />
      {hasActiveFilters && (
        <span className='border-background absolute top-1.5 right-1.5 h-2 w-2 rounded-full border bg-yellow-500' />
      )}
    </Button>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen} repositionInputs={false}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t`Sort & filter`}</DrawerTitle>
          </DrawerHeader>
          <div className='px-4 pb-8'>
            <FilterPanel filters={filters} languages={languages} onChange={onChange} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align='end'
        collisionPadding={8}
        className='max-h-[var(--radix-popover-content-available-height)] w-80 overflow-y-auto p-4'
      >
        <FilterPanel filters={filters} languages={languages} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}
