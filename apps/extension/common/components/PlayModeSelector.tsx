import React from 'react'
import { Trans } from '@lingui/react/macro'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { PlayMode } from '@asbplayer-fork/common'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  side: 'top' | 'bottom'
  selectedPlayMode?: PlayMode
  onPlayMode: (playMode: PlayMode) => void
  // The trigger element (the play-mode button in the overlay bar).
  children: React.ReactNode
}

const PlayModeItem = ({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) => (
  <button
    type='button'
    onClick={onClick}
    className={cn(
      'hover:bg-accent hover:text-accent-foreground rounded-sm px-3 py-1.5 text-sm whitespace-nowrap',
      selected && 'bg-accent text-accent-foreground'
    )}
  >
    {children}
  </button>
)

// Horizontal play-mode picker, anchored to its trigger (Radix popover —
// formerly a MUI Popover with a manual anchorEl). The content portals into the
// surface's portal container via PopoverContent's context default.
export default function PlayModeSelector({ open, onOpenChange, side, selectedPlayMode, onPlayMode, children }: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side={side} align='center' className='w-auto p-1'>
        <div className='flex flex-row overflow-x-auto'>
          <PlayModeItem selected={selectedPlayMode === PlayMode.normal} onClick={() => onPlayMode(PlayMode.normal)}>
            <Trans>Normal</Trans>
          </PlayModeItem>
          <PlayModeItem
            selected={selectedPlayMode === PlayMode.condensed}
            onClick={() => onPlayMode(PlayMode.condensed)}
          >
            <Trans>Condensed</Trans>
          </PlayModeItem>
          <PlayModeItem
            selected={selectedPlayMode === PlayMode.fastForward}
            onClick={() => onPlayMode(PlayMode.fastForward)}
          >
            <Trans>Fast-forward</Trans>
          </PlayModeItem>
          <PlayModeItem
            selected={selectedPlayMode === PlayMode.autoPause}
            onClick={() => onPlayMode(PlayMode.autoPause)}
          >
            <Trans>Auto-pause</Trans>
          </PlayModeItem>
          <PlayModeItem selected={selectedPlayMode === PlayMode.repeat} onClick={() => onPlayMode(PlayMode.repeat)}>
            <Trans>Repeat</Trans>
          </PlayModeItem>
        </div>
      </PopoverContent>
    </Popover>
  )
}
