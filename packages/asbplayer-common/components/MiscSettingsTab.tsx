import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import FormControl from '@mui/material/FormControl'
import FormLabel from '@mui/material/FormLabel'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Switch from '@mui/material/Switch'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import SettingsTextField from './SettingsTextField'
import SwitchLabelWithHoverEffect from './SwitchLabelWithHoverEffect'
import LabelWithHoverEffect from './LabelWithHoverEffect'
import { AsbplayerSettings, exportSettings, PauseOnHoverMode, validateSettings } from '../settings'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SubtitleHtml } from '..'
import DownloadIcon from '@mui/icons-material/Download'
import DeleteIcon from '@mui/icons-material/Delete'
import SettingsSection from './SettingsSection'

function regexIsValid(regex: string) {
  try {
    new RegExp(regex.trim())
    return true
  } catch (e) {
    return false
  }
}

interface Props {
  settings: AsbplayerSettings
  onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>
  onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void
  supportedLanguages: string[]
  insideApp?: boolean
  extensionInstalled?: boolean
  extensionSupportsPauseOnHover?: boolean
}

const MiscSettingTab: React.FC<Props> = ({
  settings,
  onSettingChanged,
  onSettingsChanged,
  supportedLanguages,
  insideApp,
  extensionInstalled,
  extensionSupportsPauseOnHover,
}) => {
  const { t } = useTranslation()
  const {
    themeType,
    language,
    rememberSubtitleOffset,
    autoCopyCurrentSubtitle,
    subtitleRegexFilter,
    tabName,
    subtitleRegexFilterTextReplacement,
    subtitleHtml,
    convertNetflixRuby,
    pauseOnHoverMode,
    wordClickEnabled,
    transcriptServerUrl,
    transcriptApiKey,
  } = settings
  const validRegex = useMemo(() => regexIsValid(subtitleRegexFilter), [subtitleRegexFilter])

  const settingsFileInputRef = useRef<HTMLInputElement>(null)
  const handleSettingsFileInputChange = useCallback(async () => {
    try {
      const file = settingsFileInputRef.current?.files?.[0]

      if (file === undefined) {
        return
      }

      const importedSettings = JSON.parse(await file.text())
      const validatedSettings = validateSettings(importedSettings)
      onSettingsChanged(validatedSettings)
    } catch (e) {
      console.error(e)
    }
  }, [onSettingsChanged])

  const handleImportSettings = useCallback(() => {
    settingsFileInputRef.current?.click()
  }, [])
  const handleExportSettings = useCallback(() => {
    exportSettings(settings)
  }, [settings])

  // Transcript cache management (extension only)
  const [transcriptCacheCount, setTranscriptCacheCount] = useState<number>(0)

  const refreshTranscriptCacheCount = useCallback(async () => {
    if (insideApp) return
    try {
      const response = await chrome.runtime.sendMessage({
        sender: 'asbplayer-popup',
        message: { command: 'get-transcript-cache-count', messageId: Date.now().toString() },
      })
      setTranscriptCacheCount(response?.count ?? 0)
    } catch (e) {
      console.error('Failed to get transcript cache count:', e)
    }
  }, [insideApp])

  useEffect(() => {
    refreshTranscriptCacheCount()
  }, [refreshTranscriptCacheCount])

  const handleExportTranscriptCache = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        sender: 'asbplayer-popup',
        message: { command: 'export-transcript-cache', messageId: Date.now().toString() },
      })
      if (response?.json) {
        const blob = new Blob([response.json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `transcript-cache-backup-${new Date().toISOString().split('T')[0]}.json`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      console.error('Failed to export transcript cache:', e)
    }
  }, [])

  const handleClearTranscriptCache = useCallback(async () => {
    if (!window.confirm('Are you sure you want to clear all cached transcripts? This cannot be undone.')) {
      return
    }
    try {
      await chrome.runtime.sendMessage({
        sender: 'asbplayer-popup',
        message: { command: 'clear-transcript-cache', messageId: Date.now().toString() },
      })
      setTranscriptCacheCount(0)
    } catch (e) {
      console.error('Failed to clear transcript cache:', e)
    }
  }, [])

  return (
    <>
      <Stack spacing={1}>
        <SettingsSection>{t('settings.ui')}</SettingsSection>
        <FormControl>
          <FormLabel>{t('settings.theme')}</FormLabel>
          <RadioGroup row>
            <LabelWithHoverEffect
              control={
                <Radio
                  checked={themeType === 'light'}
                  value='light'
                  onChange={(event) => event.target.checked && onSettingChanged('themeType', 'light')}
                />
              }
              label={t('settings.themeLight')}
            />
            <LabelWithHoverEffect
              control={
                <Radio
                  checked={themeType === 'dark'}
                  value='dark'
                  onChange={(event) => event.target.checked && onSettingChanged('themeType', 'dark')}
                />
              }
              label={t('settings.themeDark')}
            />
          </RadioGroup>
        </FormControl>
        <SettingsTextField
          select
          label={t('settings.language')}
          value={language}
          color='primary'
          onChange={(event) => onSettingChanged('language', event.target.value)}
        >
          {supportedLanguages.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </SettingsTextField>
        <SettingsSection>{t('settings.subtitles')}</SettingsSection>
        <SwitchLabelWithHoverEffect
          control={
            <Switch
              checked={rememberSubtitleOffset}
              onChange={(event) => onSettingChanged('rememberSubtitleOffset', event.target.checked)}
            />
          }
          label={t('settings.rememberSubtitleOffset')}
          labelPlacement='start'
        />
        <SwitchLabelWithHoverEffect
          control={
            <Switch
              checked={autoCopyCurrentSubtitle}
              onChange={(event) => onSettingChanged('autoCopyCurrentSubtitle', event.target.checked)}
            />
          }
          label={t('settings.autoCopy')}
          labelPlacement='start'
        />
        <SettingsTextField
          label={t('settings.subtitleRegexFilter')}
          fullWidth
          value={subtitleRegexFilter}
          color='primary'
          error={!validRegex}
          helperText={validRegex ? undefined : 'Invalid regular expression'}
          onChange={(event) => onSettingChanged('subtitleRegexFilter', event.target.value)}
        />
        <SettingsTextField
          label={t('settings.subtitleRegexFilterTextReplacement')}
          fullWidth
          value={subtitleRegexFilterTextReplacement}
          color='primary'
          onChange={(event) => onSettingChanged('subtitleRegexFilterTextReplacement', event.target.value)}
        />
        <FormControl>
          <FormLabel>{t('settings.subtitleHtml')}</FormLabel>
          <RadioGroup row>
            <LabelWithHoverEffect
              control={
                <Radio
                  checked={subtitleHtml === SubtitleHtml.remove}
                  value={SubtitleHtml.remove}
                  onChange={(event) => event.target.checked && onSettingChanged('subtitleHtml', SubtitleHtml.remove)}
                />
              }
              label={t('settings.subtitleHtmlRemove')}
            />
            <LabelWithHoverEffect
              control={
                <Radio
                  checked={subtitleHtml === SubtitleHtml.render}
                  value={SubtitleHtml.render}
                  onChange={(event) => event.target.checked && onSettingChanged('subtitleHtml', SubtitleHtml.render)}
                />
              }
              label={t('settings.subtitleHtmlRender')}
            />
          </RadioGroup>
        </FormControl>
        <SwitchLabelWithHoverEffect
          control={
            <Switch
              checked={convertNetflixRuby}
              onChange={(event) => onSettingChanged('convertNetflixRuby', event.target.checked)}
            />
          }
          label={t('settings.convertNetflixRuby')}
          labelPlacement='start'
        />
        {(!extensionInstalled || extensionSupportsPauseOnHover) && (
          <FormControl>
            <FormLabel component='legend'>{t('settings.pauseOnHoverMode')}</FormLabel>
            <RadioGroup row={false}>
              <LabelWithHoverEffect
                control={
                  <Radio
                    checked={pauseOnHoverMode === PauseOnHoverMode.disabled}
                    value={PauseOnHoverMode.disabled}
                    onChange={(event) =>
                      event.target.checked && onSettingChanged('pauseOnHoverMode', PauseOnHoverMode.disabled)
                    }
                  />
                }
                label={t('pauseOnHoverMode.disabled')}
              />
              <LabelWithHoverEffect
                control={
                  <Radio
                    checked={pauseOnHoverMode === PauseOnHoverMode.inAndOut}
                    value={PauseOnHoverMode.inAndOut}
                    onChange={(event) =>
                      event.target.checked && onSettingChanged('pauseOnHoverMode', PauseOnHoverMode.inAndOut)
                    }
                  />
                }
                label={t('pauseOnHoverMode.inAndOut')}
              />
              <LabelWithHoverEffect
                control={
                  <Radio
                    checked={pauseOnHoverMode === PauseOnHoverMode.inNotOut}
                    value={PauseOnHoverMode.inNotOut}
                    onChange={(event) =>
                      event.target.checked && onSettingChanged('pauseOnHoverMode', PauseOnHoverMode.inNotOut)
                    }
                  />
                }
                label={t('pauseOnHoverMode.inNotOut')}
              />
            </RadioGroup>
          </FormControl>
        )}
        {insideApp && (
          <SettingsTextField
            label={t('settings.tabName')}
            fullWidth
            value={tabName}
            color='primary'
            onChange={(event) => onSettingChanged('tabName', event.target.value)}
          />
        )}
        <SettingsSection>Word Learning</SettingsSection>
        <SwitchLabelWithHoverEffect
          control={
            <Switch
              checked={wordClickEnabled}
              onChange={(event) => onSettingChanged('wordClickEnabled', event.target.checked)}
            />
          }
          label='Enable word click mode'
          labelPlacement='start'
        />
        <SettingsSection>{t('settings.subtitleGeneration')}</SettingsSection>
        <SettingsTextField
          label={t('settings.transcriptServerUrl')}
          fullWidth
          value={transcriptServerUrl}
          color='primary'
          onChange={(event) => onSettingChanged('transcriptServerUrl', event.target.value)}
        />
        <SettingsTextField
          label={t('settings.transcriptApiKey')}
          fullWidth
          type='password'
          value={transcriptApiKey}
          color='primary'
          onChange={(event) => onSettingChanged('transcriptApiKey', event.target.value)}
        />
        {!insideApp && (
          <Stack spacing={1}>
            <Typography variant='body2'>Cached Transcripts: {transcriptCacheCount}</Typography>
            <ButtonGroup fullWidth size='small' variant='outlined'>
              <Button
                startIcon={<DownloadIcon />}
                onClick={handleExportTranscriptCache}
                disabled={transcriptCacheCount === 0}
              >
                Export
              </Button>
              <Button
                startIcon={<DeleteIcon />}
                onClick={handleClearTranscriptCache}
                disabled={transcriptCacheCount === 0}
                color='error'
              >
                Clear
              </Button>
            </ButtonGroup>
          </Stack>
        )}
        <SettingsSection>{t('settings.title')}</SettingsSection>
        <Stack direction='row' spacing={1}>
          <Button variant='contained' color='primary' style={{ flex: 1 }} onClick={handleImportSettings}>
            {t('action.importSettings')}
          </Button>
          <Button variant='contained' color='primary' style={{ flex: 1 }} onClick={handleExportSettings}>
            {t('action.exportSettings')}
          </Button>
        </Stack>
      </Stack>
      <input
        ref={settingsFileInputRef}
        onChange={handleSettingsFileInputChange}
        type='file'
        accept='.json'
        multiple
        hidden
      />
    </>
  )
}

export default MiscSettingTab
