import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { SlidersHorizontal } from 'lucide-react'
import {
  VOCAB_FILTER_SKILLS,
  type ChunksSort,
  type VocabFilterSkill,
  type VocabStatus,
} from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import { Button } from '@flicktionary/ui/components/button'
import { OptionCard } from '@flicktionary/ui/components/option-card'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { PillGrid, SectionLabel, Segmented } from '@/components/ui/filter-panel-controls'

// The Vocabulary tab's sort + filter state. `sort` always has a value;
// everything else is a narrowing filter (absent/empty = no filter).
export type VocabFilters = {
  sort: ChunksSort
  status: VocabStatus | undefined
  skills: VocabFilterSkill[]
  hasMultipleForms: boolean
}

type Props = {
  filters: VocabFilters
  onChange: (next: VocabFilters) => void
}

// The shared panel body, rendered inside the desktop popover and the mobile
// sheet alike.
const FilterPanel = ({ filters, onChange }: Props) => {
  const { t } = useLingui()
  const skillLabels: Record<VocabFilterSkill, string> = {
    recognition: t`Recognition`,
    production: t`Production`,
    pronunciation: t`Pronunciation`,
  }
  const toggleSkill = (skill: VocabFilterSkill) => {
    const skills = filters.skills.includes(skill)
      ? filters.skills.filter((s) => s !== skill)
      : [...filters.skills, skill]
    onChange({ ...filters, skills })
  }
  // 'all' is the UI-only "no status filter" choice; it maps to `undefined`.
  const statusValue: VocabStatus | 'all' = filters.status ?? 'all'
  const filtersActive = filters.status !== undefined || filters.skills.length > 0 || filters.hasMultipleForms

  return (
    <div className='flex flex-col gap-5'>
      <section className='flex flex-col gap-1.5'>
        <SectionLabel>{t`Sort`}</SectionLabel>
        <Segmented
          value={filters.sort}
          onChange={(sort) => onChange({ ...filters, sort })}
          options={[
            { value: 'recent', label: t`Recently added` },
            { value: 'due', label: t`Due soonest` },
          ]}
        />
      </section>

      <section className='flex flex-col gap-1.5'>
        <SectionLabel>{t`Status`}</SectionLabel>
        {/* One single-select bucket: 'due' plus the six SRS stages (disjoint,
            defined on the citation recognition facet — same partition the
            practice landing shows). 'Up next' lists in introduction order. */}
        <PillGrid<VocabStatus | 'all'>
          value={statusValue}
          onChange={(next) => onChange({ ...filters, status: next === 'all' ? undefined : next })}
          options={[
            { value: 'all', label: t`All` },
            { value: 'due', label: t`Due` },
            { value: 'up_next', label: t`Up next` },
            { value: 'warming_up', label: t`Warming up` },
            { value: 'learning', label: t`Learning` },
            { value: 'review', label: t`Review` },
            { value: 'strengthen', label: t`Strengthen` },
            { value: 'unseen', label: t`Unseen` },
          ]}
        />
      </section>

      <section className='flex flex-col gap-2'>
        <SectionLabel>{t`Skills`}</SectionLabel>
        {VOCAB_FILTER_SKILLS.map((skill) => (
          <OptionCard
            key={skill}
            title={skillLabels[skill]}
            indicator='checkbox'
            selected={filters.skills.includes(skill)}
            onSelect={() => toggleSkill(skill)}
          />
        ))}
      </section>

      <section className='flex flex-col gap-2'>
        <SectionLabel>{t`Forms`}</SectionLabel>
        <OptionCard
          title={t`Has multiple forms`}
          description={t`Studied in at least one inflected form`}
          indicator='checkbox'
          selected={filters.hasMultipleForms}
          onSelect={() => onChange({ ...filters, hasMultipleForms: !filters.hasMultipleForms })}
        />
      </section>

      {filtersActive && (
        <button
          type='button'
          onClick={() => onChange({ ...filters, status: undefined, skills: [], hasMultipleForms: false })}
          className='text-muted-foreground hover:text-foreground self-end text-xs font-medium underline-offset-2 hover:underline'
        >
          {t`Clear filters`}
        </button>
      )}
    </div>
  )
}

// Single "Sort & filter" control: a Radix popover on desktop, a bottom sheet on
// mobile. The trigger carries a dot when any narrowing filter is active.
export const VocabularyFilterControl = ({ filters, onChange }: Props) => {
  const { t } = useLingui()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const hasActiveFilters = filters.status !== undefined || filters.skills.length > 0 || filters.hasMultipleForms

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
            <FilterPanel filters={filters} onChange={onChange} />
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
        <FilterPanel filters={filters} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}
