import React from 'react'
import { Switch } from '@flicktionary/ui/components/switch'

interface Props {
  label: React.ReactNode
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}

// Tailwind replacement for the MUI SwitchLabelWithHoverEffect+Switch pair: a
// full-width row with the label left and the switch right. The whole row is a
// <label>, so clicking anywhere toggles (matching FormControlLabel), with a
// hover wash standing in for the MUI thumb-halo effect.
const SettingsSwitchRow = ({ label, checked, disabled, onCheckedChange }: Props) => {
  return (
    <label className='hover:bg-accent/50 -mx-2 flex cursor-pointer items-center justify-between gap-4 rounded-md px-2 py-1.5'>
      <span className='text-sm'>{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </label>
  )
}

export default SettingsSwitchRow
