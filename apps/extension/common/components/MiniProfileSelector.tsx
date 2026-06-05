import { useCallback, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import { Button } from '@flicktionary/ui/components/button'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Profile } from '../settings'

interface Props {
  profiles: Profile[]
  activeProfile?: string
  onSetActiveProfile: (profile: string | undefined) => void
}

const itemClassName = 'hover:bg-accent hover:text-accent-foreground rounded-sm px-3 py-1.5 text-left text-sm'

// Compact settings-profile switcher (Radix popover — formerly a MUI Popover
// with a manual anchorEl). The content portals into the surface's portal
// container via PopoverContent's context default.
const MiniProfileSelector = ({ profiles, activeProfile, onSetActiveProfile }: Props) => {
  const [open, setOpen] = useState<boolean>(false)
  const handleSelect = useCallback(
    (p: Profile | undefined) => {
      setOpen(false)
      onSetActiveProfile(p?.name)
    },
    [onSetActiveProfile]
  )
  if (profiles.length === 0) {
    return null
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='outline' size='sm'>
          {activeProfile ?? <Trans>Default</Trans>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='flex w-auto min-w-32 flex-col p-1'>
        <button
          type='button'
          className={cn(itemClassName, activeProfile === undefined && 'bg-accent text-accent-foreground')}
          onClick={() => handleSelect(undefined)}
        >
          <Trans>Default</Trans>
        </button>
        {profiles.map((p) => (
          <button
            type='button'
            key={p.name}
            className={cn(itemClassName, p.name === activeProfile && 'bg-accent text-accent-foreground')}
            onClick={() => handleSelect(p)}
          >
            {p.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export default MiniProfileSelector
