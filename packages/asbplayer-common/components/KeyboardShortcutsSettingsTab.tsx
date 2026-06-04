import { AsbplayerSettings, KeyBindName } from '../settings'
import { useLingui } from '@lingui/react/macro'
import { isMacOs } from 'react-device-detect'
import { useOutsideClickListener } from '@asbplayer-fork/common/hooks'
import hotkeys from 'hotkeys-js'
import { Pencil } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Input } from '@flicktionary/ui/components/input'
import { Switch } from '@flicktionary/ui/components/switch'
import { RadioGroup, RadioGroupItem } from '@flicktionary/ui/components/radio-group'
import { isFirefox } from '../browser-detection'
import React, { useMemo, useEffect, useCallback, useState, useRef, useId } from 'react'
import KeyBindRelatedSetting from './KeyBindRelatedSetting'
import { AutoPausePreference } from '..'

type AllKeyNames = KeyBindName | 'selectSubtitleTrack'

interface KeyBindProperties {
  label: string
  boundViaChrome: boolean
  hide?: boolean
  additionalControl?: React.ReactNode
}

// hotkeys only returns strings for a Mac while requiring the OS-specific keys for the actual binds
const modifierKeyReplacements: { [key: string]: string } = isMacOs
  ? {}
  : {
      '⌃': 'ctrl',
      '⇧': 'shift',
      '⌥': 'alt',
    }

const modifierKeys = ['⌃', '⇧', '⌥', 'ctrl', 'shift', 'alt', 'option', 'control', 'command', '⌘']

interface KeyBindFieldProps {
  label: string
  keys: string
  boundViaChrome: boolean
  onKeysChange: (keys: string) => void
  onOpenExtensionShortcuts: () => void
}

function KeyBindField({ label, keys, boundViaChrome, onKeysChange, onOpenExtensionShortcuts }: KeyBindFieldProps) {
  const { t } = useLingui()
  const [currentKeyString, setCurrentKeyString] = useState<string>(keys)
  const currentKeyStringRef = useRef<string>(undefined)
  currentKeyStringRef.current = currentKeyString
  const onKeysChangeRef = useRef<(keys: string) => void>(undefined)
  onKeysChangeRef.current = onKeysChange
  const [editing, setEditing] = useState<boolean>(false)

  useEffect(() => setCurrentKeyString(keys), [keys])

  const handleEditKeyBinding = useCallback(
    (event: React.MouseEvent) => {
      if (event.nativeEvent.detail === 0) {
        return
      }

      if (boundViaChrome) {
        onOpenExtensionShortcuts()
        return
      }

      setCurrentKeyString('')
      setEditing(true)
    },
    [onOpenExtensionShortcuts, boundViaChrome]
  )

  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!editing) {
      return
    }

    const handler = (event: KeyboardEvent) => {
      if (event.type === 'keydown') {
        // The ts declaration is missing getPressedKeyString()
        // @ts-ignore
        const pressed = hotkeys.getPressedKeyString() as string[]
        setCurrentKeyString(
          pressed
            .map((key) => {
              return modifierKeyReplacements[key] ?? key
            })
            .sort((a, b) => {
              const isAModifier = modifierKeys.includes(a)
              const isBModifier = modifierKeys.includes(b)

              if (isAModifier && !isBModifier) {
                return -1
              }

              if (!isAModifier && isBModifier) {
                return 1
              }

              return 0
            })
            .join('+')
        )
      } else if (event.type === 'keyup') {
        setEditing(false)

        // Need to use refs because hotkeys returns the wrong keys
        // if the handler is bound/unbound.
        if (currentKeyStringRef.current) {
          onKeysChangeRef.current!(currentKeyStringRef.current)
        }
      }
    }

    hotkeys('*', { keyup: true }, handler)
    return () => hotkeys.unbind('*', handler)
  }, [editing])

  useOutsideClickListener(
    ref,
    useCallback(() => {
      if (editing) {
        setEditing(false)
        setCurrentKeyString('')
        onKeysChange('')
      }
    }, [editing, onKeysChange])
  )

  let placeholder: string

  if (editing) {
    placeholder = t`Recording`
  } else if (boundViaChrome) {
    placeholder = t`Overridden`
  } else {
    placeholder = t`Unbound`
  }

  const firefoxExtensionShortcut = isFirefox && boundViaChrome

  return (
    <div className='hover:bg-accent/50 mb-2 flex items-start gap-2 rounded-md p-2'>
      <div className='w-3/5 shrink-0 pt-2 text-sm'>{label}</div>
      <div className='flex flex-1 flex-col gap-1'>
        <div className='relative'>
          <Input
            readOnly
            placeholder={placeholder}
            disabled={boundViaChrome}
            value={currentKeyString}
            title={currentKeyString}
            className='pr-9 text-sm'
          />
          <span className='absolute top-1/2 right-1 flex -translate-y-1/2 items-center'>
            {!firefoxExtensionShortcut && (
              <Button
                ref={ref}
                type='button'
                variant='ghost'
                size='icon-sm'
                className='size-7 md:size-7'
                onClick={handleEditKeyBinding}
              >
                <Pencil className='size-4' />
              </Button>
            )}
            {firefoxExtensionShortcut && (
              <span title={t`Edit this shortcut from the Plugin manager at about:addons.`}>
                <Button type='button' variant='ghost' size='icon-sm' className='size-7 md:size-7' disabled>
                  <Pencil className='size-4' />
                </Button>
              </span>
            )}
          </span>
        </div>
        {boundViaChrome && <p className='text-muted-foreground text-xs'>{t`Extension shortcut`}</p>}
      </div>
    </div>
  )
}

interface AutoPausePreferenceSelectorProps {
  autoPausePreference: AutoPausePreference
  onAutoPausePreferenceChanged: (preference: AutoPausePreference) => void
}

const AutoPausePreferenceSelector = ({
  autoPausePreference,
  onAutoPausePreferenceChanged,
}: AutoPausePreferenceSelectorProps) => {
  const { t } = useLingui()
  const id = useId()
  const options = [
    { value: AutoPausePreference.atStart, label: t`At Subtitle Start` },
    { value: AutoPausePreference.atEnd, label: t`At Subtitle End` },
  ]

  return (
    <RadioGroup
      value={String(autoPausePreference)}
      onValueChange={(value) => onAutoPausePreferenceChanged(Number(value) as AutoPausePreference)}
      className='flex flex-row flex-wrap justify-end gap-x-4 gap-y-1'
    >
      {options.map((option) => (
        <label
          key={option.value}
          htmlFor={`${id}-${option.value}`}
          className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5'
        >
          <RadioGroupItem id={`${id}-${option.value}`} value={String(option.value)} />
          <span className='text-sm'>{option.label}</span>
        </label>
      ))}
    </RadioGroup>
  )
}

interface Props {
  settings: AsbplayerSettings
  onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>
  chromeKeyBinds: { [key: string]: string | undefined }
  extensionInstalled?: boolean
  extensionSupportsExportCardBind?: boolean
  onOpenChromeExtensionShortcuts: () => void
}

const KeyboardShortcutsSettingsTab: React.FC<Props> = ({
  settings,
  onSettingChanged,
  chromeKeyBinds,
  extensionInstalled,
  extensionSupportsExportCardBind,
  onOpenChromeExtensionShortcuts,
}) => {
  const { t } = useLingui()
  const {
    autoPausePreference,
    fastForwardModePlaybackRate,
    seekDuration,
    alwaysPlayOnSubtitleRepeat,
    speedChangeStep,
    keyBindSet,
  } = settings
  const keyBindProperties = useMemo<{ [key in AllKeyNames]: KeyBindProperties }>(
    () => ({
      selectSubtitleTrack: {
        label: t`Select subtitle tracks to load.`,
        boundViaChrome: true,
        hide: !extensionInstalled,
      },
      togglePlay: { label: t`Play/pause`, boundViaChrome: false },
      toggleAutoPause: {
        label: t`Toggle auto-pause`,
        boundViaChrome: false,
        additionalControl: (
          <KeyBindRelatedSetting
            label={t`Auto-pause preference`}
            control={
              <AutoPausePreferenceSelector
                autoPausePreference={autoPausePreference}
                onAutoPausePreferenceChanged={(preference) => onSettingChanged('autoPausePreference', preference)}
              />
            }
          />
        ),
      },
      toggleCondensedPlayback: { label: t`Toggle condensed playback`, boundViaChrome: false },
      toggleFastForwardPlayback: {
        label: t`Toggle fast forward playback`,
        boundViaChrome: false,
        additionalControl: (
          <KeyBindRelatedSetting
            label={t`Fast-forward mode playback rate`}
            control={
              <Input
                type='number'
                className='max-w-28 text-sm'
                value={fastForwardModePlaybackRate}
                min={0.1}
                max={5}
                step={0.1}
                onChange={(event) => onSettingChanged('fastForwardModePlaybackRate', Number(event.target.value))}
              />
            }
          />
        ),
      },
      toggleRepeat: { label: t`Toggle repeat mode`, boundViaChrome: false },
      toggleSubtitles: { label: t`Toggle subtitles`, boundViaChrome: false },
      toggleVideoSubtitleTrack1: { label: t`Toggle subtitle track 1 in video`, boundViaChrome: false },
      toggleVideoSubtitleTrack2: { label: t`Toggle subtitle track 2 in video`, boundViaChrome: false },
      toggleVideoSubtitleTrack3: { label: t`Toggle subtitle track 3 in video`, boundViaChrome: false },
      toggleAsbplayerSubtitleTrack1: {
        label: t`Toggle subtitle track 1 in asbplayer`,
        boundViaChrome: false,
      },
      toggleAsbplayerSubtitleTrack2: {
        label: t`Toggle subtitle track 2 in asbplayer`,
        boundViaChrome: false,
      },
      toggleAsbplayerSubtitleTrack3: {
        label: t`Toggle subtitle track 3 in asbplayer`,
        boundViaChrome: false,
      },
      unblurAsbplayerTrack1: {
        label: t`Unblur subtitle track ${1} in asbplayer`,
        boundViaChrome: false,
      },
      unblurAsbplayerTrack2: {
        label: t`Unblur subtitle track ${2} in asbplayer`,
        boundViaChrome: false,
      },
      unblurAsbplayerTrack3: {
        label: t`Unblur subtitle track ${3} in asbplayer`,
        boundViaChrome: false,
      },
      seekBackward: { label: t`Seek backward`, boundViaChrome: false },
      seekForward: {
        label: t`Seek forward`,
        boundViaChrome: false,
        additionalControl: (
          <KeyBindRelatedSetting
            label={t`Seek interval (seconds)`}
            control={
              <Input
                type='number'
                className='max-w-28 text-sm'
                value={seekDuration}
                min={1}
                max={60}
                step={1}
                onChange={(event) => onSettingChanged('seekDuration', Number(event.target.value))}
              />
            }
          />
        ),
      },
      seekToPreviousSubtitle: { label: t`Seek to previous subtitle`, boundViaChrome: false },
      seekToNextSubtitle: { label: t`Seek to next subtitle`, boundViaChrome: false },
      seekToBeginningOfCurrentSubtitle: {
        label: t`Seek to beginning of current/previous subtitle`,
        boundViaChrome: false,
        additionalControl: (
          <KeyBindRelatedSetting
            label={t`Always play (unpause) after invoking above shortcut`}
            control={
              <Switch
                checked={alwaysPlayOnSubtitleRepeat}
                onCheckedChange={(checked) => onSettingChanged('alwaysPlayOnSubtitleRepeat', checked)}
              />
            }
          />
        ),
      },
      adjustOffsetToPreviousSubtitle: {
        label: t`Adjust subtitle offset so that previous subtitle is at current timestamp`,
        boundViaChrome: false,
      },
      adjustOffsetToNextSubtitle: {
        label: t`Adjust subtitle offset so that next subtitle is at current timestamp`,
        boundViaChrome: false,
      },
      increaseOffset: { label: t`Adjust subtitle offset by +100ms`, boundViaChrome: false },
      decreaseOffset: { label: t`Adjust subtitle offset by -100ms`, boundViaChrome: false },
      resetOffset: { label: t`Reset subtitle offset`, boundViaChrome: false },
      increasePlaybackRate: { label: t`Increase playback rate`, boundViaChrome: false },
      decreasePlaybackRate: {
        label: t`Decrease playback rate`,
        boundViaChrome: false,
        additionalControl: (
          <KeyBindRelatedSetting
            label={t`Playback speed adjust step`}
            control={
              <Input
                type='number'
                className='max-w-28 text-sm'
                value={speedChangeStep}
                min={0.1}
                max={1}
                step={0.1}
                onChange={(event) => onSettingChanged('speedChangeStep', Number(event.target.value))}
              />
            }
          />
        ),
      },
      moveBottomSubtitlesUp: {
        label: t`Move bottom subtitles up`,
        boundViaChrome: false,
      },
      moveBottomSubtitlesDown: {
        label: t`Move bottom subtitles down`,
        boundViaChrome: false,
      },
      moveTopSubtitlesUp: {
        label: t`Move top subtitles up`,
        boundViaChrome: false,
      },
      moveTopSubtitlesDown: {
        label: t`Move top subtitles down`,
        boundViaChrome: false,
      },
    }),
    [
      t,
      extensionInstalled,
      extensionSupportsExportCardBind,
      onSettingChanged,
      seekDuration,
      alwaysPlayOnSubtitleRepeat,
      autoPausePreference,
      speedChangeStep,
      fastForwardModePlaybackRate,
    ]
  )

  const handleKeysChange = useCallback(
    (keys: string, keyBindName: KeyBindName) => {
      onSettingChanged('keyBindSet', { ...settings.keyBindSet, [keyBindName]: { keys } })
    },
    [settings.keyBindSet, onSettingChanged]
  )

  return Object.keys(keyBindProperties).map((key) => {
    const keyBindName = key as KeyBindName
    const properties = keyBindProperties[keyBindName]

    if (properties.hide) {
      return null
    }

    return (
      <div key={key}>
        <KeyBindField
          key={key}
          label={properties.label}
          keys={
            extensionInstalled && properties.boundViaChrome
              ? (chromeKeyBinds[keyBindName] ?? '')
              : keyBindSet[keyBindName].keys
          }
          boundViaChrome={Boolean(extensionInstalled) && properties.boundViaChrome}
          onKeysChange={(keys) => handleKeysChange(keys, keyBindName)}
          onOpenExtensionShortcuts={onOpenChromeExtensionShortcuts}
        />
        {properties.additionalControl}
      </div>
    )
  })
}

export default KeyboardShortcutsSettingsTab
