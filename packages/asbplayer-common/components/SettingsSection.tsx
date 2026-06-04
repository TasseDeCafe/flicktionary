import React from 'react'

interface Props {
  children: React.ReactNode
}

const SettingsSection = React.forwardRef<HTMLHeadingElement, Props>(function SettingsSection({ children }, ref) {
  return (
    <h2 ref={ref} className='pt-2 pb-1 text-2xl font-bold'>
      {children}
    </h2>
  )
})

export default SettingsSection
