import { AsbplayerSettings, KeyBindName } from '../settings'
import { useLingui } from '@lingui/react/macro'
import { isMacOs } from 'react-device-detect'
import { makeStyles } from 'tss-react/mui'
import { useTheme } from '@mui/material/styles'
import { type Theme } from '@mui/material'
import { useOutsideClickListener } from '@asbplayer-fork/common/hooks'
import hotkeys from 'hotkeys-js'
import Grid2 from '@mui/material/Grid2'
import Typography from '@mui/material/Typography'
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Switch from '@mui/material/Switch'
import EditIcon from '@mui/icons-material/Edit'
import SettingsTextField from './SettingsTextField'
import { isFirefox } from '../browser-detection'
import React, { useMemo, useEffect, useCallback, useState, useRef } from 'react'
import KeyBindRelatedSetting from './KeyBindRelatedSetting'
import LabelWithHoverEffect from './LabelWithHoverEffect'
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

const useKeyBindFieldStyles = makeStyles()((theme) => ({
  container: {
    marginBottom: theme.spacing(1),
  },
  labelItem: {
    marginTop: theme.spacing(1),
  },
}))

interface KeyBindFieldProps {
  label: string
  keys: string
  boundViaChrome: boolean
  onKeysChange: (keys: string) => void
  onOpenExtensionShortcuts: () => void
}

function KeyBindField({ label, keys, boundViaChrome, onKeysChange, onOpenExtensionShortcuts }: KeyBindFieldProps) {
  const { t } = useLingui()
  const theme = useTheme<Theme>()
  const { classes } = useKeyBindFieldStyles()
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
    <Grid2 container className={classes.container} wrap={'nowrap'} spacing={1}>
      <Grid2 sx={{ '&:hover': { background: theme.palette.action.hover }, p: 1 }} container direction='row' size={12}>
        <Grid2 className={classes.labelItem} size={7.5}>
          <Typography>{label}</Typography>
        </Grid2>
        <Grid2 size='grow'>
          <SettingsTextField
            placeholder={placeholder}
            size='small'
            contentEditable={false}
            disabled={boundViaChrome}
            helperText={boundViaChrome ? t`Extension shortcut` : undefined}
            value={currentKeyString}
            title={currentKeyString}
            color='primary'
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position='end'>
                    {!firefoxExtensionShortcut && (
                      <IconButton ref={ref} sx={{ marginRight: -1 }} onClick={handleEditKeyBinding}>
                        <EditIcon fontSize='small' />
                      </IconButton>
                    )}
                    {firefoxExtensionShortcut && (
                      <Tooltip title={t`Edit this shortcut from the Plugin manager at about:addons.`}>
                        <span>
                          <IconButton disabled={true}>
                            <EditIcon fontSize='small' />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </InputAdornment>
                ),
              },
            }}
          />
        </Grid2>
      </Grid2>
    </Grid2>
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
              <Grid2>
                <RadioGroup row>
                  <LabelWithHoverEffect
                    control={
                      <Radio
                        checked={autoPausePreference === AutoPausePreference.atStart}
                        value={AutoPausePreference.atStart}
                        onChange={(event) =>
                          event.target.checked && onSettingChanged('autoPausePreference', AutoPausePreference.atStart)
                        }
                      />
                    }
                    label={t`At Subtitle Start`}
                  />
                  <LabelWithHoverEffect
                    control={
                      <Radio
                        checked={autoPausePreference === AutoPausePreference.atEnd}
                        value={AutoPausePreference.atEnd}
                        onChange={(event) =>
                          event.target.checked && onSettingChanged('autoPausePreference', AutoPausePreference.atEnd)
                        }
                      />
                    }
                    label={t`At Subtitle End`}
                  />
                </RadioGroup>
              </Grid2>
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
              <SettingsTextField
                type='number'
                fullWidth
                value={fastForwardModePlaybackRate}
                color='primary'
                onChange={(event) => onSettingChanged('fastForwardModePlaybackRate', Number(event.target.value))}
                slotProps={{
                  htmlInput: {
                    min: 0.1,
                    max: 5,
                    step: 0.1,
                  },
                }}
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
              <SettingsTextField
                type='number'
                size='small'
                fullWidth
                value={seekDuration}
                color='primary'
                onChange={(event) => onSettingChanged('seekDuration', Number(event.target.value))}
                slotProps={{
                  htmlInput: {
                    min: 1,
                    max: 60,
                    step: 1,
                  },
                }}
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
                onChange={(event) => onSettingChanged('alwaysPlayOnSubtitleRepeat', event.target.checked)}
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
              <SettingsTextField
                type='number'
                fullWidth
                value={speedChangeStep}
                color='primary'
                onChange={(event) => onSettingChanged('speedChangeStep', Number(event.target.value))}
                slotProps={{
                  htmlInput: {
                    min: 0.1,
                    max: 1,
                    step: 0.1,
                  },
                }}
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
