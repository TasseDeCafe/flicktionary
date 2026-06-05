import React, { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { HexColorPicker } from 'react-colorful'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import SettingsField from './SettingsField'

interface Props {
  label: React.ReactNode
  value: string
  onValueChange: (value: string) => void
}

// Color fields can't use a native <input type=color>: Firefox renders its
// picker as an OS-level dialog, which blurs — and therefore closes — the
// browser-action popup before a color can be picked. react-colorful inside a
// Radix Popover keeps everything in-document, so the popup stays open (and
// Chrome gets the same UX instead of the native dialog).
const SettingsColorField = ({ label, value, onValueChange }: Props) => {
  const { t } = useLingui()
  // Free-typed text is held locally until it parses as #rrggbb, so partial
  // input doesn't round-trip through settings as an invalid color.
  const [draft, setDraft] = useState<string>()

  return (
    <SettingsField
      label={label}
      value={draft ?? value}
      spellCheck={false}
      onChange={(e) => {
        const text = e.target.value
        setDraft(text)
        if (/^#[0-9a-fA-F]{6}$/.test(text)) {
          onValueChange(text)
        }
      }}
      onBlur={() => setDraft(undefined)}
      endAdornment={
        <Popover>
          <PopoverTrigger asChild>
            <button
              type='button'
              aria-label={t`Pick a color`}
              className='border-input size-7 cursor-pointer rounded-md border shadow-xs'
              style={{ backgroundColor: value }}
            />
          </PopoverTrigger>
          <PopoverContent className='w-auto p-3' side='bottom' align='end'>
            <HexColorPicker
              color={value}
              onChange={(color) => {
                setDraft(undefined)
                onValueChange(color)
              }}
            />
          </PopoverContent>
        </Popover>
      }
    />
  )
}

export default SettingsColorField
