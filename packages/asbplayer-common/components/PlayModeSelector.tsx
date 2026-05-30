import React from 'react'
import { Trans } from '@lingui/react/macro'
import List from '@mui/material/List'
import MuiListItem, { ListItemProps } from '@mui/material/ListItem'
import MuiListItemButton, { ListItemButtonProps } from '@mui/material/ListItemButton'
import Popover from '@mui/material/Popover'
import type { PopoverProps } from '@mui/material/Popover'
import { PlayMode } from '@asbplayer-fork/common'
import ListItemText from '@mui/material/ListItemText'

interface Props extends PopoverProps {
  open: boolean
  listStyle?: React.CSSProperties
  anchorEl?: Element
  selectedPlayMode?: PlayMode
  onPlayMode: (playMode: PlayMode) => void
  onClose: () => void
}

const ListItem = ({ children, ...props }: ListItemProps) => {
  return (
    <MuiListItem disablePadding dense {...props}>
      {children}
    </MuiListItem>
  )
}

const ListItemButton = ({ children, ...props }: ListItemButtonProps) => {
  return (
    <MuiListItemButton dense {...props}>
      {children}
    </MuiListItemButton>
  )
}

export default function PlayModeSelector({
  listStyle,
  selectedPlayMode,
  onPlayMode,
  open,
  anchorEl,
  onClose,
  ...restOfPopoverProps
}: Props) {
  return (
    <Popover
      disableEnforceFocus={true}
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'center',
      }}
      transformOrigin={{
        vertical: 'bottom',
        horizontal: 'center',
      }}
      {...restOfPopoverProps}
    >
      <List disablePadding dense style={listStyle}>
        <ListItem onClick={() => onPlayMode(PlayMode.normal)}>
          <ListItemButton selected={selectedPlayMode === PlayMode.normal}>
            <ListItemText>
              <Trans>Normal</Trans>
            </ListItemText>
          </ListItemButton>
        </ListItem>
        <ListItem onClick={() => onPlayMode(PlayMode.condensed)}>
          <ListItemButton dense selected={selectedPlayMode === PlayMode.condensed}>
            <ListItemText>
              <Trans>Condensed</Trans>
            </ListItemText>
          </ListItemButton>
        </ListItem>
        <ListItem onClick={() => onPlayMode(PlayMode.fastForward)}>
          <ListItemButton selected={selectedPlayMode === PlayMode.fastForward}>
            <ListItemText>
              <Trans>Fast-forward</Trans>
            </ListItemText>
          </ListItemButton>
        </ListItem>
        <ListItem onClick={() => onPlayMode(PlayMode.autoPause)}>
          <ListItemButton selected={selectedPlayMode === PlayMode.autoPause}>
            <ListItemText>
              <Trans>Auto-pause</Trans>
            </ListItemText>
          </ListItemButton>
        </ListItem>
        <ListItem onClick={() => onPlayMode(PlayMode.repeat)}>
          <ListItemButton selected={selectedPlayMode === PlayMode.repeat}>
            <ListItemText>
              <Trans>Repeat</Trans>
            </ListItemText>
          </ListItemButton>
        </ListItem>
      </List>
    </Popover>
  )
}
