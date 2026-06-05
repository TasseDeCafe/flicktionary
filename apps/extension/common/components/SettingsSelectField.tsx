import React, { useId } from 'react'
import { Label } from '@flicktionary/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@flicktionary/ui/components/select'

interface Option {
  value: string
  label?: React.ReactNode
}

interface Props {
  label: React.ReactNode
  value: string
  options: Option[]
  disabled?: boolean
  helperText?: React.ReactNode
  onValueChange: (value: string) => void
}

// Tailwind replacement for the MUI `SettingsTextField select` pattern: a
// label-above ui/select. Options with falsy labels render their value.
const SettingsSelectField = ({ label, value, options, disabled, helperText, onValueChange }: Props) => {
  const id = useId()

  return (
    <div className='flex w-full flex-col gap-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} disabled={disabled} onValueChange={onValueChange}>
        <SelectTrigger id={id} className='w-full'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label ?? option.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {helperText !== undefined && <p className='text-muted-foreground text-xs'>{helperText}</p>}
    </div>
  )
}

export default SettingsSelectField
