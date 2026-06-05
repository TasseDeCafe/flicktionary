import { useEffect, useId, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Check, ChevronDownIcon, Trash2, X } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Label } from '@flicktionary/ui/components/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@flicktionary/ui/components/dropdown-menu'
import SettingsField from './SettingsField'
import { Profile } from '../settings'

const maxProfileNameLength = 16
const maxProfiles = 5

interface Props {
  profiles: Profile[]
  activeProfile?: string
  onNewProfile: (name: string) => void
  onRemoveProfile: (name: string) => void
  onSetActiveProfile: (name: string | undefined) => void
}

// Profile picker + create/delete. A dropdown-menu rather than a select: the
// per-profile delete buttons are interactive content inside the menu items,
// which Radix Select items (plain options) can't host.
export default function SettingsProfileSelectMenu({
  profiles,
  activeProfile,
  onNewProfile,
  onRemoveProfile,
  onSetActiveProfile,
}: Props) {
  const { t } = useLingui()
  const id = useId()

  const [addingNewProfile, setAddingNewProfile] = useState<boolean>(false)
  const [newProfile, setNewProfile] = useState<string>('')
  const trimmed = newProfile.trim()
  const validNewProfile =
    trimmed !== '' &&
    trimmed !== '-' &&
    trimmed.length >= 1 &&
    trimmed.length <= maxProfileNameLength &&
    profiles.find((p) => p.name === trimmed) === undefined

  useEffect(() => {
    if (!addingNewProfile) {
      return
    }

    const keyListener = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        if (!validNewProfile) {
          return
        }

        setAddingNewProfile(false)
        onNewProfile(newProfile.trim())
      }
    }

    document.addEventListener('keypress', keyListener)
    return () => document.removeEventListener('keypress', keyListener)
  }, [addingNewProfile, newProfile, onNewProfile, validNewProfile])
  const limitReached = profiles.length >= maxProfiles

  if (addingNewProfile) {
    return (
      <SettingsField
        label={t`Profile Name`}
        placeholder={t`Enter profile name`}
        value={newProfile}
        maxLength={maxProfileNameLength}
        autoFocus
        onChange={(e) => {
          setNewProfile(e.target.value)
        }}
        endAdornment={
          <>
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              className='size-7 md:size-7'
              onClick={() => {
                setAddingNewProfile(false)
              }}
            >
              <X className='size-4' />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              className='size-7 md:size-7'
              disabled={!validNewProfile}
              onClick={() => {
                setAddingNewProfile(false)
                onNewProfile(newProfile.trim())
              }}
            >
              <Check className='size-4' />
            </Button>
          </>
        }
      />
    )
  }

  return (
    <div className='flex w-full flex-col gap-1.5'>
      <Label htmlFor={id}>
        <Trans>Profile</Trans>
      </Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type='button' id={id} variant='outline' className='w-full justify-between font-normal'>
            {activeProfile ?? <Trans>Default</Trans>}
            <ChevronDownIcon className='size-4 opacity-50' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-(--radix-dropdown-menu-trigger-width)'>
          <DropdownMenuItem onSelect={() => onSetActiveProfile(undefined)}>
            <Trans>Default</Trans>
          </DropdownMenuItem>
          {profiles.map((profile) => (
            <DropdownMenuItem key={profile.name} onSelect={() => onSetActiveProfile(profile.name)}>
              <span className='flex-1'>{profile.name}</span>
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                className='size-6 md:size-6'
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  // Don't let the click select/activate the surrounding item.
                  e.stopPropagation()
                  onRemoveProfile(profile.name)
                }}
              >
                <Trash2 className='size-4' />
              </Button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={limitReached}
            className='justify-center'
            onSelect={() => {
              setNewProfile('')
              setAddingNewProfile(true)
            }}
          >
            {limitReached ? <Trans>Profile limit reached</Trans> : <Trans>Add New Profile...</Trans>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
