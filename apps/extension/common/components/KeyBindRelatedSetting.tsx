import React from 'react'

interface Props {
  label: React.ReactNode
  control: React.ReactNode
}

// A setting row attached to a keybind (e.g. "Seek interval" under the seek
// shortcut): label left, control right, hover wash like the keybind rows.
export default function KeyBindRelatedSetting({ label, control }: Props) {
  return (
    <div className='hover:bg-accent/50 flex items-center gap-2 rounded-md p-2'>
      <div className='w-3/5 shrink-0 text-sm'>{label}</div>
      <div className='flex flex-1 justify-end text-right'>{control}</div>
    </div>
  )
}
