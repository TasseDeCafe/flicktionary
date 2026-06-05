import React, { useId } from 'react'
import { Label } from '@flicktionary/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@flicktionary/ui/components/radio-group'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

interface Option<T extends string> {
  value: T
  label: React.ReactNode
}

interface Props<T extends string> {
  label: React.ReactNode
  value: T
  options: Option<T>[]
  row?: boolean
  onValueChange: (value: T) => void
}

// Tailwind replacement for the MUI FormControl+FormLabel+RadioGroup+
// LabelWithHoverEffect+Radio stack: a captioned ui/radio-group, horizontal
// when `row` is set (matching MUI's `RadioGroup row`).
const SettingsRadioGroupField = <T extends string>({ label, value, options, row, onValueChange }: Props<T>) => {
  const id = useId()

  return (
    <div className='flex flex-col gap-2'>
      <Label>{label}</Label>
      <RadioGroup
        value={value}
        onValueChange={(newValue) => onValueChange(newValue as T)}
        className={cn('gap-1', row && 'flex flex-row flex-wrap gap-x-4')}
      >
        {options.map((option) => (
          <label
            key={option.value}
            htmlFor={`${id}-${option.value}`}
            className='hover:bg-accent/50 -mx-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5'
          >
            <RadioGroupItem id={`${id}-${option.value}`} value={option.value} />
            <span className='text-sm'>{option.label}</span>
          </label>
        ))}
      </RadioGroup>
    </div>
  )
}

export default SettingsRadioGroupField
