import React, { useId } from 'react'
import { Input } from '@flicktionary/ui/components/input'
import { Label } from '@flicktionary/ui/components/label'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

interface Props extends Omit<React.ComponentProps<'input'>, 'id'> {
  label: React.ReactNode
  // Shown red below the input (and marks it aria-invalid). Wins over helperText.
  errorText?: string
  helperText?: string
  // Static unit suffix rendered inside the input's right edge (e.g. 'ms').
  suffix?: string
  // Interactive adornment (icon buttons, units) anchored to the input's right
  // edge — the MUI endAdornment equivalent. Rendered after `suffix` if both set.
  endAdornment?: React.ReactNode
}

// Tailwind replacement for the MUI SettingsTextField (label-above + input).
const SettingsField = ({ label, errorText, helperText, suffix, endAdornment, className, ...inputProps }: Props) => {
  const id = useId()
  const caption = errorText ?? helperText
  const hasRightContent = suffix !== undefined || endAdornment !== undefined

  return (
    <div className='flex w-full flex-col gap-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <div className='relative'>
        <Input
          id={id}
          aria-invalid={errorText !== undefined || undefined}
          className={cn('text-sm', hasRightContent && 'pr-10', className)}
          {...inputProps}
        />
        {hasRightContent && (
          <span className='absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-1'>
            {suffix !== undefined && (
              <span className='text-muted-foreground pointer-events-none px-2 text-sm'>{suffix}</span>
            )}
            {endAdornment}
          </span>
        )}
      </div>
      {caption !== undefined && (
        <p className={cn('text-xs', errorText !== undefined ? 'text-destructive' : 'text-muted-foreground')}>
          {caption}
        </p>
      )}
    </div>
  )
}

export default SettingsField
